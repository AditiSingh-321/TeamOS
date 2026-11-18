begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated, service_role;

create table public.project_documents (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 uploaded_by uuid not null references auth.users(id) on delete restrict,
 uploaded_by_name text not null,
 filename text not null check (length(filename) between 1 and 180),
 storage_path text not null unique,
 mime_type text not null check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/markdown')),
 file_size integer not null check (file_size between 1 and 3145728),
 content_hash text,
 processing_status text not null default 'Pending' check (processing_status in ('Pending','Processing','Ready','Failed','Deleting')),
 error_message text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,project_id,id),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create index documents_project on public.project_documents(project_id,created_at desc);
create index documents_workspace on public.project_documents(workspace_id);
create table public.document_chunks (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.project_documents(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 chunk_index integer not null check (chunk_index >= 0),
 content text not null check (length(content) between 1 and 16000),
 content_hash text not null,
 embedding extensions.vector(1536) not null,
 embedding_model text not null check (embedding_model = 'text-embedding-3-small'),
 page_number integer check (page_number > 0), section_title text,
 created_at timestamptz not null default now(),
 unique(document_id, chunk_index),
 foreign key(workspace_id,project_id,document_id) references public.project_documents(workspace_id,project_id,id) on delete cascade
);
create index chunks_project on public.document_chunks(project_id, document_id);
create index chunks_workspace on public.document_chunks(workspace_id);
-- Exact cosine search within an authorized project avoids approximate-index tenant under-recall.
-- Add a scoped ANN strategy only after measuring a larger corpus.
create table private.document_jobs (
 id uuid primary key default gen_random_uuid(), document_id uuid not null,
 storage_path text not null, kind text not null check(kind in ('ingest','cleanup')),
 state text not null default 'queued' check(state in ('queued','running','done','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, error_message text,
 unique(document_id,kind)
);
create index document_jobs_queue on private.document_jobs(available_at) where state in ('queued','running');
create table private.document_requests (user_id uuid not null references auth.users(id) on delete cascade, kind text not null, created_at timestamptz not null default now());
create index document_requests_user_time on private.document_requests(user_id,kind,created_at);
alter table private.document_requests enable row level security;
create table private.rag_requests (user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create index rag_requests_user_time on private.rag_requests(user_id,created_at);

alter table public.project_documents enable row level security;
alter table public.document_chunks enable row level security;
alter table private.document_jobs enable row level security;
alter table private.rag_requests enable row level security;
revoke all on public.project_documents, public.document_chunks from public, anon, authenticated;
grant select on public.project_documents, public.document_chunks to authenticated;
grant all on public.project_documents, public.document_chunks to service_role;
create policy documents_read on public.project_documents for select to authenticated using (
 private.workspace_role_for(workspace_id) is not null and processing_status <> 'Deleting'
 and exists(select 1 from public.projects p where p.id=project_id and p.workspace_id=project_documents.workspace_id)
);
create policy chunks_read on public.document_chunks for select to authenticated using (
 private.workspace_role_for(workspace_id) is not null and exists(
 select 1 from public.project_documents d where d.id=document_id and d.project_id=document_chunks.project_id
 and d.workspace_id=document_chunks.workspace_id and d.processing_status='Ready')
);

create function public.reserve_document(target_project uuid, document_name text, document_mime text, document_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects; d public.project_documents; ext text;
begin
 select * into p from public.projects where id=target_project;
 if p.id is null or private.workspace_role_for(p.workspace_id) is null then raise exception 'Project unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7));
 if (select count(*) from private.document_requests where user_id=auth.uid() and kind='upload' and created_at > now()-interval '1 hour') >= 10
 or (select count(*) from public.project_documents where project_id=p.id) >= 100 then raise exception 'Document upload limit reached' using errcode='P0001'; end if;
 ext := lower(substring(document_name from '[.]([^.]+)$'));
 if document_name ~ '[/\\[:cntrl:]]' or not (
 (ext='pdf' and document_mime='application/pdf') or (ext='docx' and document_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 or (ext='txt' and document_mime='text/plain') or (ext='md' and document_mime='text/markdown')) then raise exception 'Unsupported file' using errcode='23514'; end if;
 delete from private.document_requests where created_at<now()-interval '1 day';
 insert into private.document_requests(user_id,kind) values(auth.uid(),'upload');
 d.id:=gen_random_uuid();
 insert into public.project_documents(id,workspace_id,project_id,uploaded_by,uploaded_by_name,filename,storage_path,mime_type,file_size)
 values(d.id,p.workspace_id,p.id,auth.uid(),private.member_display_name(),document_name,
 p.workspace_id::text||'/'||p.id::text||'/'||d.id::text||'/source.'||ext,document_mime,document_size) returning * into d;
 -- Reclaim incomplete uploads durably, even when a route crashes.
 insert into private.document_jobs(document_id,storage_path,kind,available_at) values(d.id,d.storage_path,'cleanup',now()+interval '1 hour');
 return to_jsonb(d);
end; $$;

create function public.queue_document(target_document uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.project_documents;
begin
 select * into d from public.project_documents where id=target_document for update;
 if d.id is null or private.workspace_role_for(d.workspace_id) is null
 or not (d.uploaded_by=auth.uid() or private.workspace_role_for(d.workspace_id) in ('owner','admin')) then raise exception 'Document unavailable' using errcode='42501'; end if;
 if d.processing_status not in ('Pending','Failed') or (d.processing_status='Pending' and exists(select 1 from private.document_jobs where document_id=d.id and kind='ingest' and state in ('queued','running'))) then raise exception 'Document cannot be queued'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7));
 if (select count(*) from private.document_requests where user_id=auth.uid() and kind='process' and created_at>now()-interval '1 hour')>=20 then raise exception 'Processing limit reached' using errcode='P0001'; end if;
 insert into private.document_requests(user_id,kind) values(auth.uid(),'process');
 if not exists(select 1 from storage.objects where bucket_id='project-documents' and name=d.storage_path) then raise exception 'File missing'; end if;
 update private.document_jobs set state='done', lease_token=null, lease_until=null where document_id=d.id and kind='cleanup';
 update public.project_documents set processing_status='Pending',error_message=null,updated_at=now() where id=d.id;
 insert into private.document_jobs(document_id,storage_path,kind) values(d.id,d.storage_path,'ingest')
 on conflict(document_id,kind) do update set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null,error_message=null;
end; $$;

create function public.delete_document(target_document uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.project_documents;
begin
 select * into d from public.project_documents where id=target_document for update;
 if d.id is null or private.workspace_role_for(d.workspace_id) is null
 or not (d.uploaded_by=auth.uid() or private.workspace_role_for(d.workspace_id) in ('owner','admin')) then raise exception 'Document unavailable' using errcode='42501'; end if;
 update public.project_documents set processing_status='Deleting',updated_at=now() where id=d.id;
 delete from public.document_chunks where document_id=d.id;
 update private.document_jobs set state='done',lease_token=null,lease_until=null where document_id=d.id and kind='ingest';
 insert into private.document_jobs(document_id,storage_path,kind) values(d.id,d.storage_path,'cleanup')
 on conflict(document_id,kind) do update set state='queued',available_at=now(),lease_token=null,lease_until=null;
end; $$;

create function private.document_deleted() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.processing_status <> 'Deleting' then
 insert into private.document_jobs(document_id,storage_path,kind) values(old.id,old.storage_path,'cleanup')
 on conflict(document_id,kind) do update set state='queued',available_at=now(),lease_token=null,lease_until=null;
 end if;
 return old;
end; $$;
create trigger document_file_cleanup after delete on public.project_documents for each row execute function private.document_deleted();

create function public.claim_document_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.document_jobs; d public.project_documents;
begin
 select * into j from private.document_jobs where (state='queued' and available_at<=now())
 or (state='running' and lease_until<now()) order by available_at,id limit 1;
 if j.id is null then return null; end if;
 select * into d from public.project_documents where id=j.document_id for update skip locked;
 if d.id is null and exists(select 1 from public.project_documents where id=j.document_id) then return null; end if;
 select * into j from private.document_jobs where id=j.id and ((state='queued' and available_at<=now()) or (state='running' and lease_until<now())) for update skip locked;
 if j.id is null then return null; end if;
 if j.kind='ingest' and j.attempts>=3 then
 update private.document_jobs set state='failed',error_message='Processing attempts exhausted. Retry from Documents.' where id=j.id;
 update public.project_documents set processing_status='Failed',error_message='Processing attempts exhausted. Retry from Documents.',updated_at=now() where id=d.id and processing_status<>'Deleting';
 return null; end if;
 if j.kind='ingest' and (d.id is null or d.processing_status='Deleting') then
 update private.document_jobs set state='done' where id=j.id; return null; end if;
 update private.document_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
 if j.kind='ingest' then update public.project_documents set processing_status='Processing',error_message=null,updated_at=now() where id=d.id;
 elsif d.id is not null then update public.project_documents set processing_status='Deleting',updated_at=now() where id=d.id; end if;
 return jsonb_build_object('job',to_jsonb(j),'document',to_jsonb(d));
end; $$;

create function public.finish_document_job(job_id uuid, token uuid, chunks jsonb default '[]', file_hash text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j private.document_jobs; d public.project_documents; c jsonb;
begin
 select * into j from private.document_jobs where id=job_id;
 perform 1 from public.project_documents where id=j.document_id for update;
 select * into j from private.document_jobs where id=job_id for update;
 if j.state<>'running' or j.lease_token is distinct from token or j.lease_until<now() then return false; end if;
 select * into d from public.project_documents where id=j.document_id for update;
 if j.kind='cleanup' then
 if d.id is not null and d.processing_status not in ('Pending','Deleting') then return false; end if;
 update public.project_documents set processing_status='Deleting' where id=d.id;
 delete from public.project_documents where id=d.id;
 else
 if d.id is null or d.processing_status<>'Processing' then return false; end if;
 if jsonb_typeof(chunks)<>'array' or jsonb_array_length(chunks) not between 1 and 200 then raise exception 'Invalid chunks'; end if;
 delete from public.document_chunks where document_id=d.id;
 update private.document_jobs set lease_until=now()+interval '10 minutes' where id=j.id;
 for c in select value from jsonb_array_elements(chunks) loop
 insert into public.document_chunks(document_id,workspace_id,project_id,chunk_index,content,content_hash,embedding,embedding_model,page_number,section_title)
 values(d.id,d.workspace_id,d.project_id,(c->>'chunk_index')::integer,c->>'content',c->>'content_hash',
 (c->>'embedding')::extensions.vector,'text-embedding-3-small',(c->>'page_number')::integer,c->>'section_title');
 end loop;
 update public.project_documents set processing_status='Ready',content_hash=file_hash,error_message=null,updated_at=now() where id=d.id;
 end if;
 update private.document_jobs set state='done',lease_token=null,lease_until=null,error_message=null where id=j.id;
 return true;
end; $$;

create function public.fail_document_job(job_id uuid, token uuid, safe_error text, permanent boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare j private.document_jobs; retry boolean;
begin
 select * into j from private.document_jobs where id=job_id;
 perform 1 from public.project_documents where id=j.document_id for update;
 select * into j from private.document_jobs where id=job_id for update;
 if j.state<>'running' or j.lease_token is distinct from token then return; end if;
 retry := j.kind='cleanup' or (j.attempts<3 and not permanent);
 update private.document_jobs set state=case when retry then 'queued' else 'failed' end,
 available_at=now()+least(3600,30*power(2,least(j.attempts,7))) * interval '1 second',
 lease_token=null,lease_until=null,error_message=left(safe_error,300) where id=j.id;
 if j.kind='ingest' then update public.project_documents set processing_status=case when retry then 'Pending' else 'Failed' end,
 error_message=left(safe_error,300),updated_at=now() where id=j.document_id and processing_status<>'Deleting'; end if;
end; $$;

create function public.reserve_rag_question(target_project uuid) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 select workspace_id into wid from public.projects where id=target_project;
 if wid is null or private.workspace_role_for(wid) is null then raise exception 'Project unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8));
 if (select count(*) from private.rag_requests where user_id=auth.uid() and created_at>now()-interval '1 minute')>=6
 or (select count(*) from private.rag_requests where user_id=auth.uid() and created_at>now()-interval '1 day')>=100 then raise exception 'Question limit reached' using errcode='P0001'; end if;
 delete from private.rag_requests where created_at<now()-interval '1 day';
 insert into private.rag_requests(user_id) values(auth.uid());
end; $$;

create function public.search_project_documents(target_project uuid, query_embedding extensions.vector(1536), match_count integer default 6, minimum_similarity double precision default 0.25)
returns table(id uuid,document_id uuid,filename text,content text,page_number integer,section_title text,similarity double precision)
language sql stable security invoker set search_path='' as $$
 select c.id,c.document_id,d.filename,c.content,c.page_number,c.section_title,1-(c.embedding operator(extensions.<=>) query_embedding)
 from public.document_chunks c join public.project_documents d on d.id=c.document_id
 where c.project_id=target_project and d.project_id=target_project and d.workspace_id=c.workspace_id
 and private.workspace_role_for(c.workspace_id) is not null and d.processing_status='Ready'
 and c.embedding_model='text-embedding-3-small'
 and 1-(c.embedding operator(extensions.<=>) query_embedding)>=greatest(0.0,least(1.0,minimum_similarity))
 order by c.embedding operator(extensions.<=>) query_embedding,c.id limit greatest(1,least(match_count,8));
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('project-documents','project-documents',false,3145728,
 array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/markdown']);
create policy project_document_storage_read on storage.objects for select to authenticated using (
 bucket_id='project-documents' and exists(select 1 from public.project_documents d where d.storage_path=name and d.processing_status<>'Deleting')
);
create policy project_document_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id='project-documents' and exists(select 1 from public.project_documents d where d.storage_path=name and d.uploaded_by=auth.uid() and d.processing_status='Pending')
);
-- Clients cannot overwrite or delete stored objects. The leased worker owns cleanup.
revoke all on function public.reserve_document(uuid,text,text,integer),public.queue_document(uuid),public.delete_document(uuid),
 public.reserve_rag_question(uuid),public.search_project_documents(uuid,extensions.vector,integer,double precision) from public,anon;
grant execute on function public.reserve_document(uuid,text,text,integer),public.queue_document(uuid),public.delete_document(uuid),
 public.reserve_rag_question(uuid),public.search_project_documents(uuid,extensions.vector,integer,double precision) to authenticated;
revoke all on function public.claim_document_job(),public.finish_document_job(uuid,uuid,jsonb,text),public.fail_document_job(uuid,uuid,text,boolean),private.document_deleted() from public,anon,authenticated;
grant execute on function public.claim_document_job(),public.finish_document_job(uuid,uuid,jsonb,text),public.fail_document_job(uuid,uuid,text,boolean) to service_role;
create function public.checkpoint_document_embeddings(job_id uuid, token uuid, chunks jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j private.document_jobs; d public.project_documents; c jsonb;
begin
 select * into j from private.document_jobs where id=job_id;
 perform 1 from public.project_documents where id=j.document_id for update;
 select * into j from private.document_jobs where id=job_id for update;
 if j.state<>'running' or j.kind<>'ingest' or j.lease_token is distinct from token or j.lease_until<now() then return false; end if;
 select * into d from public.project_documents where id=j.document_id for update;
 if d.id is null or d.processing_status<>'Processing' then return false; end if;
 if jsonb_typeof(chunks)<>'array' or jsonb_array_length(chunks)>32 then raise exception 'Invalid batch'; end if;
 update private.document_jobs set lease_until=now()+interval '10 minutes' where id=j.id;
 for c in select value from jsonb_array_elements(chunks) loop
 insert into public.document_chunks(document_id,workspace_id,project_id,chunk_index,content,content_hash,embedding,embedding_model,page_number,section_title)
 values(d.id,d.workspace_id,d.project_id,(c->>'chunk_index')::integer,c->>'content',c->>'content_hash',
 (c->>'embedding')::extensions.vector,'text-embedding-3-small',(c->>'page_number')::integer,c->>'section_title')
 on conflict(document_id,chunk_index) do update set content=excluded.content,content_hash=excluded.content_hash,embedding=excluded.embedding,page_number=excluded.page_number,section_title=excluded.section_title;
 end loop;
 return true;
end; $$;
revoke all on function public.checkpoint_document_embeddings(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_document_embeddings(uuid,uuid,jsonb) to service_role;
commit;
