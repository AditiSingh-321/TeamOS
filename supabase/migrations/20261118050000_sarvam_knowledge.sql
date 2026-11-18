begin;
-- Keep original files/text and replace only provider-specific derived vectors.
-- Invalidate old worker leases before switching the index contract.
update private.document_jobs set state='queued',available_at=now(),lease_token=null,lease_until=null,attempts=0 where kind='ingest' and state='running';
update public.project_documents set processing_status='Pending',error_message=null where processing_status='Processing';
alter table public.document_chunks drop constraint document_chunks_embedding_model_check;
alter table public.document_chunks alter column embedding drop not null;
alter table public.document_chunks alter column embedding_model drop not null;
alter table public.document_chunks alter column embedding type extensions.vector(768) using null::extensions.vector(768);
update public.document_chunks set embedding_model=null;
alter table public.document_chunks add constraint document_chunks_embedding_model_check check (
 (embedding is null and embedding_model is null) or (embedding is not null and embedding_model='embeddinggemma-2')
);
alter table public.document_chunks add column search_vector tsvector generated always as (to_tsvector('english'::regconfig, content)) stored;
create index document_chunks_text on public.document_chunks using gin(search_vector);

create or replace function public.finish_document_job(job_id uuid, token uuid, chunks jsonb default '[]', file_hash text default null)
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
 (c->>'embedding')::extensions.vector,c->>'embedding_model',(c->>'page_number')::integer,c->>'section_title');
 end loop;
 update public.project_documents set processing_status='Ready',content_hash=file_hash,error_message=null,updated_at=now() where id=d.id;
 end if;
 update private.document_jobs set state='done',lease_token=null,lease_until=null,error_message=null where id=j.id;
 return true;
end; $$;

create or replace function public.checkpoint_document_embeddings(job_id uuid, token uuid, chunks jsonb)
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
 (c->>'embedding')::extensions.vector,c->>'embedding_model',(c->>'page_number')::integer,c->>'section_title')
 on conflict(document_id,chunk_index) do update set content=excluded.content,content_hash=excluded.content_hash,embedding=excluded.embedding,page_number=excluded.page_number,section_title=excluded.section_title;
 end loop;
 return true;
end; $$;

create or replace function public.search_project_documents(target_project uuid, query_embedding extensions.vector(768), match_count integer default 6, minimum_similarity double precision default 0.25)
returns table(id uuid,document_id uuid,filename text,content text,page_number integer,section_title text,similarity double precision)
language sql stable security invoker set search_path='' as $$
 select c.id,c.document_id,d.filename,c.content,c.page_number,c.section_title,1-(c.embedding operator(extensions.<=>) query_embedding)
 from public.document_chunks c join public.project_documents d on d.id=c.document_id
 where c.project_id=target_project and d.project_id=target_project and d.workspace_id=c.workspace_id
 and private.workspace_role_for(c.workspace_id) is not null and d.processing_status='Ready'
 and c.embedding_model='embeddinggemma-2' and c.embedding is not null
 and 1-(c.embedding operator(extensions.<=>) query_embedding)>=greatest(0.0,least(1.0,minimum_similarity))
 order by c.embedding operator(extensions.<=>) query_embedding,c.id limit greatest(1,least(match_count,8));
$$;

create function public.search_project_documents_text(target_project uuid, search_query text, match_count integer default 6)
returns table(id uuid,document_id uuid,filename text,content text,page_number integer,section_title text,similarity real)
language sql stable security invoker set search_path='' as $$
 with terms as (select unnest(tsvector_to_array(to_tsvector('english'::regconfig,left(search_query,2500)))) as word),
 query as (select string_agg(quote_literal(word),' | ')::tsquery as value from terms)
 select c.id,c.document_id,d.filename,c.content,c.page_number,c.section_title,ts_rank_cd(c.search_vector,query.value)
 from public.document_chunks c join public.project_documents d on d.id=c.document_id cross join query
 where c.project_id=target_project and d.project_id=target_project and c.workspace_id=d.workspace_id
 and private.workspace_role_for(c.workspace_id) is not null and d.processing_status='Ready'
 and c.search_vector @@ query.value
 order by ts_rank_cd(c.search_vector,query.value) desc,c.id limit greatest(1,least(match_count,8));
$$;
revoke all on function public.search_project_documents_text(uuid,text,integer) from public,anon;
grant execute on function public.search_project_documents_text(uuid,text,integer) to authenticated;
create or replace function public.queue_document(target_document uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.project_documents;
begin
 select * into d from public.project_documents where id=target_document for update;
 if d.id is null or private.workspace_role_for(d.workspace_id) is null
 or not (d.uploaded_by=auth.uid() or private.workspace_role_for(d.workspace_id) in ('owner','admin')) then raise exception 'Document unavailable' using errcode='42501'; end if;
 if d.processing_status not in ('Pending','Failed','Ready') or (d.processing_status='Pending' and exists(select 1 from private.document_jobs where document_id=d.id and kind='ingest' and state in ('queued','running'))) then raise exception 'Document cannot be queued'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7));
 if (select count(*) from private.document_requests where user_id=auth.uid() and kind='process' and created_at>now()-interval '1 hour')>=20 then raise exception 'Processing limit reached' using errcode='P0001'; end if;
 insert into private.document_requests(user_id,kind) values(auth.uid(),'process');
 if not exists(select 1 from storage.objects where bucket_id='project-documents' and name=d.storage_path) then raise exception 'File missing'; end if;
 update private.document_jobs set state='done', lease_token=null, lease_until=null where document_id=d.id and kind='cleanup';
 update public.project_documents set processing_status='Pending',error_message=null,updated_at=now() where id=d.id;
 insert into private.document_jobs(document_id,storage_path,kind) values(d.id,d.storage_path,'ingest')
 on conflict(document_id,kind) do update set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null,error_message=null;
end; $$;
commit;
