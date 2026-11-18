begin;
create table public.meetings(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 title text not null check(length(btrim(title)) between 1 and 120),meeting_date date not null,
 participants jsonb not null check(jsonb_typeof(participants)='array' and jsonb_array_length(participants)<=30),
 transcript text not null check(length(btrim(transcript)) between 20 and 16000),created_by uuid references auth.users(id) on delete set null,
 revision integer not null default 1,status text not null default 'draft' check(status in ('draft','reviewed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,project_id,id),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create index meetings_project on public.meetings(project_id,meeting_date desc);
create table public.meeting_analyses(
 id uuid primary key default gen_random_uuid(),meeting_id uuid not null references public.meetings(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,meeting_revision integer not null,
 revision integer not null default 1,status text not null default 'queued' check(status in ('queued','draft','reviewed','failed')),
 source_snapshot jsonb not null default '{}',draft jsonb,reviewed jsonb,error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(meeting_id,meeting_revision)
);
create index analyses_meeting on public.meeting_analyses(meeting_id,meeting_revision desc);
alter table public.meetings enable row level security;alter table public.meeting_analyses enable row level security;
revoke all on public.meetings,public.meeting_analyses from public,anon,authenticated;
grant select on public.meetings,public.meeting_analyses to authenticated;
grant select on public.meetings,public.meeting_analyses,public.project_risks,public.project_risk_events to service_role;
create policy meetings_read on public.meetings for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
create policy analyses_read on public.meeting_analyses for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
alter table public.project_risk_events add column meeting_id uuid references public.meetings(id) on delete set null;
alter table private.intelligence_jobs drop constraint intelligence_jobs_kind_check;
alter table private.intelligence_jobs add constraint intelligence_jobs_kind_check check(kind in ('risk_event','meeting_analysis','meeting_index'));
alter table public.document_chunks alter column document_id drop not null;
alter table public.document_chunks add column meeting_id uuid;
alter table public.document_chunks add column source_revision integer;
alter table public.document_chunks add constraint chunks_one_source check((document_id is not null and meeting_id is null) or (document_id is null and meeting_id is not null and source_revision is not null));
alter table public.document_chunks add constraint chunks_meeting_scope foreign key(workspace_id,project_id,meeting_id) references public.meetings(workspace_id,project_id,id) on delete cascade;
create unique index chunks_meeting_index on public.document_chunks(meeting_id,chunk_index) where meeting_id is not null;
drop policy chunks_read on public.document_chunks;
create policy chunks_read on public.document_chunks for select to authenticated using(private.workspace_role_for(workspace_id) is not null and (
 exists(select 1 from public.project_documents d where d.id=document_id and d.project_id=document_chunks.project_id and d.workspace_id=document_chunks.workspace_id and d.processing_status='Ready') or
 exists(select 1 from public.meetings m where m.id=meeting_id and m.project_id=document_chunks.project_id and m.workspace_id=document_chunks.workspace_id and m.status='reviewed' and m.revision=source_revision)
));
create function private.can_edit_meeting(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.meetings m where m.id=mid and private.workspace_role_for(m.workspace_id) is not null and (m.created_by=auth.uid() or private.workspace_role_for(m.workspace_id) in ('owner','admin')));
$$;
create function public.save_meeting(target_project uuid,meeting_id uuid,expected_revision integer,input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.meetings;wid uuid;
begin
 select workspace_id into wid from public.projects where id=target_project;
 if wid is null or private.workspace_role_for(wid) is null then raise exception 'Project access required' using errcode='42501';end if;
 if coalesce(jsonb_typeof(input->'participants'),'')<>'array' or exists(select 1 from jsonb_array_elements(input->'participants') p where jsonb_typeof(p)<>'string' or length(p#>>'{}') not between 1 and 100) then raise exception 'Invalid participants';end if;
 if meeting_id is null then
 if (select count(*) from public.meetings where project_id=target_project)>=200 then raise exception 'Meeting limit reached';end if;
 insert into public.meetings(workspace_id,project_id,title,meeting_date,participants,transcript,created_by) values(wid,target_project,input->>'title',(input->>'meeting_date')::date,input->'participants',input->>'transcript',auth.uid()) returning * into m;
 else
 if not private.can_edit_meeting(meeting_id) then raise exception 'Meeting access required' using errcode='42501';end if;
 update public.meetings set title=input->>'title',meeting_date=(input->>'meeting_date')::date,participants=input->'participants',transcript=input->>'transcript',revision=revision+1,status='draft',updated_at=now()
 where id=meeting_id and project_id=target_project and revision=expected_revision returning * into m;
 if m.id is null then raise exception 'Meeting changed' using errcode='40001';end if;
 delete from public.document_chunks where document_chunks.meeting_id=m.id;
 end if;return m.id;
end; $$;
create function public.delete_meeting(target_meeting uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_edit_meeting(target_meeting) then raise exception 'Meeting access required' using errcode='42501';end if;
 delete from public.meetings where id=target_meeting and revision=expected_revision;
 if not found then raise exception 'Meeting changed' using errcode='40001';end if;
end; $$;
create function public.queue_meeting_analysis(target_meeting uuid,expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.meetings;a public.meeting_analyses;
begin
 if not private.can_edit_meeting(target_meeting) then raise exception 'Meeting access required' using errcode='42501';end if;
 select * into m from public.meetings where id=target_meeting for update;
 if m.revision<>expected_revision then raise exception 'Meeting changed' using errcode='40001';end if;
 select * into a from public.meeting_analyses where meeting_id=m.id and meeting_revision=m.revision;
 if a.status in ('draft','reviewed','queued') then return a.id;end if;
 perform public.reserve_rag_question(m.project_id);
 insert into public.meeting_analyses(meeting_id,workspace_id,meeting_revision,source_snapshot) values(m.id,m.workspace_id,m.revision,jsonb_build_object('title',m.title,'meeting_date',m.meeting_date,'participants',m.participants,'transcript',m.transcript))
 on conflict(meeting_id,meeting_revision) do update set status='queued',error_message=null returning * into a;
 insert into private.intelligence_jobs(kind,source_id,project_id) values('meeting_analysis',a.id,m.project_id)
 on conflict(kind,source_id) do update set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null;
 return a.id;
end; $$;
create function public.finish_meeting_analysis(job_id uuid,token uuid,draft jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;a public.meeting_analyses;m public.meetings;
begin
 select * into j from private.intelligence_jobs where id=job_id for update;
 if j.kind<>'meeting_analysis' or j.state<>'running' or j.lease_token is distinct from token or j.lease_until<now() then return false;end if;
 select * into a from public.meeting_analyses where id=j.source_id for update;
 select * into m from public.meetings where id=a.meeting_id;
 if m.id is null or m.revision<>a.meeting_revision then update private.intelligence_jobs set state='done' where id=j.id;return false;end if;
 if jsonb_typeof(draft)<>'object' or octet_length(draft::text)>60000 then raise exception 'Invalid analysis';end if;
 update public.meeting_analyses set draft=finish_meeting_analysis.draft,status='draft',revision=revision+1,updated_at=now() where id=a.id;
 update private.intelligence_jobs set state='done',lease_token=null,lease_until=null where id=j.id;return true;
end; $$;
create function public.save_reviewed_meeting(target_analysis uuid,expected_revision integer,reviewed jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a public.meeting_analyses;m public.meetings;item jsonb;eid uuid;
begin
 select * into a from public.meeting_analyses where id=target_analysis for update;
 if not private.can_edit_meeting(a.meeting_id) then raise exception 'Meeting access required' using errcode='42501';end if;
 select * into m from public.meetings where id=a.meeting_id for update;
 if a.revision<>expected_revision or m.revision<>a.meeting_revision or a.status not in ('draft','reviewed') then raise exception 'Analysis changed' using errcode='40001';end if;
 if coalesce(jsonb_typeof(reviewed),'')<>'object' or coalesce(length(reviewed->>'summary'),0) not between 1 and 2000 or octet_length(reviewed::text)>60000 then raise exception 'Invalid review';end if;
 if exists(select 1 from unnest(array['decisions','actionItems','blockers','taskUpdates','openQuestions','recommendations']) k where coalesce(jsonb_typeof(reviewed->k),'')<>'array' or jsonb_array_length(reviewed->k)>10) then raise exception 'Invalid review sections';end if;
 for item in select value from jsonb_array_elements(reviewed->'decisions') union all select value from jsonb_array_elements(reviewed->'actionItems') union all select value from jsonb_array_elements(reviewed->'blockers') union all select value from jsonb_array_elements(reviewed->'taskUpdates') loop
 if coalesce(length(item->>'evidence'),0)<1 or strpos(m.transcript,item->>'evidence')=0 then raise exception 'Source evidence does not match';end if;
 if item->>'taskId' is not null and not exists(select 1 from public.tasks where id=(item->>'taskId')::uuid and project_id=m.project_id) then raise exception 'Task outside meeting project' using errcode='42501';end if;
 if item->>'assigneeId' is not null and not exists(select 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=(item->>'assigneeId')::uuid) then raise exception 'Invalid assignee' using errcode='42501';end if;
 end loop;
 update public.meeting_analyses set reviewed=save_reviewed_meeting.reviewed,status='reviewed',revision=revision+1,updated_at=now() where id=a.id;
 update public.meetings set status='reviewed',updated_at=now() where id=m.id;
 delete from public.document_chunks where meeting_id=m.id;
 insert into private.intelligence_jobs(kind,source_id,project_id) values('meeting_index',a.id,m.project_id)
 on conflict(kind,source_id) do update set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null;
 for item in select value from jsonb_array_elements(reviewed->'blockers') loop
 if not coalesce((item->>'ignore')::boolean,false) and item->>'taskId' is not null then
 eid:=private.enqueue_risk_event(m.workspace_id,m.project_id,(item->>'taskId')::uuid,'meeting',item->>'evidence','meeting:'||m.id||':'||(item->>'taskId')||':'||md5(item->>'evidence'));
 if eid is not null then update public.project_risk_events set meeting_id=m.id where id=eid;end if;
 end if;
 end loop;
end; $$;
create function public.finish_meeting_index(job_id uuid,token uuid,expected_revision integer,chunks jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;a public.meeting_analyses;m public.meetings;c jsonb;
begin
 select * into j from private.intelligence_jobs where id=job_id for update;
 if j.kind<>'meeting_index' or j.state<>'running' or j.lease_token is distinct from token or j.lease_until<now() then return false;end if;
 select * into a from public.meeting_analyses where id=j.source_id for update;select * into m from public.meetings where id=a.meeting_id;
 if a.revision<>expected_revision or a.status<>'reviewed' or m.id is null or m.revision<>a.meeting_revision or m.status<>'reviewed' then return false;end if;
 if jsonb_typeof(chunks)<>'array' or jsonb_array_length(chunks) not between 1 and 100 then raise exception 'Invalid meeting chunks';end if;
 delete from public.document_chunks where meeting_id=m.id;
 for c in select value from jsonb_array_elements(chunks) loop
 insert into public.document_chunks(workspace_id,project_id,meeting_id,source_revision,chunk_index,content,content_hash,embedding,embedding_model,page_number,section_title)
 values(m.workspace_id,m.project_id,m.id,m.revision,(c->>'chunk_index')::integer,c->>'content',c->>'content_hash',(c->>'embedding')::extensions.vector,c->>'embedding_model',null,c->>'section_title');
 end loop;
 update private.intelligence_jobs set state='done',lease_token=null,lease_until=null where id=j.id;return true;
end; $$;
create or replace function public.claim_intelligence_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;e public.project_risk_events;
begin
 select * into j from private.intelligence_jobs where (state='queued' and available_at<=now()) or (state='running' and lease_until<now()) order by available_at,id for update skip locked limit 1;
 if j.id is null then return null;end if;
 if j.attempts>=3 then update private.intelligence_jobs set state='failed',error_message='Attempts exhausted; request reanalysis.' where id=j.id;update public.meeting_analyses set status='failed',error_message='Analysis attempts exhausted. Retry analysis.' where id=j.source_id and j.kind='meeting_analysis';return null;end if;
 update private.intelligence_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 select * into e from public.project_risk_events where id=j.source_id;
 return jsonb_build_object('job',to_jsonb(j),'event',to_jsonb(e),'context',public.intelligence_context(j.project_id),'analysis',(select to_jsonb(a) from public.meeting_analyses a where a.id=j.source_id),'meeting',(select to_jsonb(m) from public.meetings m join public.meeting_analyses a on a.meeting_id=m.id where a.id=j.source_id),'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',wm.user_id,'display_name',wm.display_name)),'[]') from public.workspace_members wm join public.projects p on p.workspace_id=wm.workspace_id where p.id=j.project_id));
end; $$;
drop function public.search_project_documents(uuid,extensions.vector,integer,double precision);
create function public.search_project_documents(target_project uuid,query_embedding extensions.vector(768),match_count integer default 6,minimum_similarity double precision default 0.25) returns table(id uuid,document_id uuid,meeting_id uuid,filename text,content text,page_number integer,section_title text,similarity double precision)
language sql stable security invoker set search_path='' as $$

 select c.id,c.document_id,c.meeting_id,coalesce(d.filename,'Meeting: '||m.title),c.content,c.page_number,c.section_title,1-(c.embedding operator(extensions.<=>) query_embedding)
 from public.document_chunks c left join public.project_documents d on d.id=c.document_id left join public.meetings m on m.id=c.meeting_id
 where c.project_id=target_project and private.workspace_role_for(c.workspace_id) is not null
 and ((d.project_id=target_project and d.workspace_id=c.workspace_id and d.processing_status='Ready') or (m.project_id=target_project and m.workspace_id=c.workspace_id and m.status='reviewed' and m.revision=c.source_revision))
 and c.embedding_model='embeddinggemma-2' and c.embedding is not null and 1-(c.embedding operator(extensions.<=>) query_embedding)>=greatest(0.0,least(1.0,minimum_similarity)) order by c.embedding operator(extensions.<=>) query_embedding,c.id limit greatest(1,least(match_count,8));
$$;
revoke all on function public.search_project_documents(uuid,extensions.vector,integer,double precision) from public,anon;
grant execute on function public.search_project_documents(uuid,extensions.vector,integer,double precision) to authenticated;
drop function public.search_project_documents_text(uuid,text,integer);
create function public.search_project_documents_text(target_project uuid,search_query text,match_count integer default 6) returns table(id uuid,document_id uuid,meeting_id uuid,filename text,content text,page_number integer,section_title text,similarity double precision)
language sql stable security invoker set search_path='' as $$
 with terms as(select unnest(tsvector_to_array(to_tsvector('english'::regconfig,left(search_query,2500)))) as word),query as(select string_agg(quote_literal(word),' | ')::tsquery as value from terms)
 select c.id,c.document_id,c.meeting_id,coalesce(d.filename,'Meeting: '||m.title),c.content,c.page_number,c.section_title,ts_rank_cd(c.search_vector,query.value)::double precision
 from public.document_chunks c left join public.project_documents d on d.id=c.document_id left join public.meetings m on m.id=c.meeting_id cross join query
 where c.project_id=target_project and private.workspace_role_for(c.workspace_id) is not null
 and ((d.project_id=target_project and d.workspace_id=c.workspace_id and d.processing_status='Ready') or (m.project_id=target_project and m.workspace_id=c.workspace_id and m.status='reviewed' and m.revision=c.source_revision))
 and c.search_vector @@ query.value order by ts_rank_cd(c.search_vector,query.value) desc,c.id limit greatest(1,least(match_count,8));
$$;
revoke all on function public.search_project_documents_text(uuid,text,integer) from public,anon;
grant execute on function public.search_project_documents_text(uuid,text,integer) to authenticated;
revoke all on function public.save_meeting(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_meeting(uuid,uuid,integer,jsonb) to authenticated;
revoke all on function public.delete_meeting(uuid,integer) from public,anon;
grant execute on function public.delete_meeting(uuid,integer) to authenticated;
revoke all on function public.queue_meeting_analysis(uuid,integer) from public,anon;
grant execute on function public.queue_meeting_analysis(uuid,integer) to authenticated;
revoke all on function public.save_reviewed_meeting(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_reviewed_meeting(uuid,integer,jsonb) to authenticated;
revoke all on function public.finish_meeting_analysis(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_meeting_analysis(uuid,uuid,jsonb) to service_role;
revoke all on function public.finish_meeting_index(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_meeting_index(uuid,uuid,integer,jsonb) to service_role;
revoke all on function private.can_edit_meeting(uuid) from public,anon,authenticated;
create or replace function public.fail_intelligence_job(job_id uuid,token uuid) returns void language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;
begin
 update private.intelligence_jobs set state=case when attempts<3 then 'queued' else 'failed' end,available_at=now()+interval '1 minute',lease_token=null,lease_until=null,error_message='Analysis failed. Retry later or request reanalysis.'
 where id=job_id and state='running' and lease_token=token returning * into j;
 if j.kind='meeting_analysis' then update public.meeting_analyses set status=case when j.attempts<3 then 'queued' else 'failed' end,error_message='Analysis failed. Automatic retries are limited to three attempts.' where id=j.source_id;end if;
end; $$;
create or replace function public.finish_risk_job(job_id uuid,token uuid,observed jsonb,result jsonb,impacts jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;e public.project_risk_events;t public.tasks;r public.project_risks;item jsonb;rid uuid;finger text;actual jsonb;
begin
 select * into j from private.intelligence_jobs where id=job_id for update;
 if j.state<>'running' or j.lease_token is distinct from token or j.lease_until<now() then return false;end if;
 actual:=public.intelligence_context(j.project_id);
 if actual->'tasks' is distinct from observed->'tasks' or actual->'edges' is distinct from observed->'edges' then raise exception 'Project changed during analysis' using errcode='40001';end if;
 select * into e from public.project_risk_events where id=j.source_id;
 select * into t from public.tasks where id=e.source_task_id and project_id=e.project_id;
 for r in select * from public.project_risks where project_id=j.project_id and status in ('active','acknowledged') for update loop
 if r.source_task_id is null or exists(select 1 from public.tasks where id=r.source_task_id and (status='Done' or project_id is distinct from r.project_id)) or
 (r.evidence->>'kind'='blocked_flag' and exists(select 1 from public.tasks where id=r.source_task_id and not is_blocked)) or
 (r.evidence->>'kind'='overdue' and exists(select 1 from public.tasks where id=r.source_task_id and (due_date is null or due_date>=current_date))) or
 (r.source_task_id=t.id and result->>'state' in ('resolved','completed') and r.evidence->>'kind' in ('comment','meeting')) then
 update public.project_risks set status='resolved',resolved_at=now(),updated_at=now() where id=r.id;
 insert into public.risk_history(risk_id,workspace_id,status,note) values(r.id,r.workspace_id,'resolved','Resolved by current task state or source update');
 end if;
 end loop;
 if t.id is not null and t.status<>'Done' and result->>'state' in ('confirmed','possible') then
 finger:=t.id::text||':'||(result->>'blockerType');
 -- An older event cannot reopen a risk that a user has already closed.
 if not exists(select 1 from public.project_risks where project_id=e.project_id and fingerprint=finger and status in ('resolved','dismissed') and resolved_at>=e.created_at) then
 select id into rid from public.project_risks where project_id=e.project_id and fingerprint=finger and status in ('active','acknowledged') for update;
 if rid is null then
 insert into public.project_risks(workspace_id,project_id,source_task_id,source_event_id,blocker_type,confirmation,title,description,severity,score,confidence,reported_delay_days,evidence,explanations,recommendations,fingerprint)
 values(e.workspace_id,e.project_id,t.id,e.id,result->>'blockerType',result->>'state',t.title,result->>'reason','Low',0,(result->>'confidence')::double precision,(result->>'reportedDelayDays')::integer,jsonb_build_object('kind',e.kind,'text',e.evidence,'meeting_id',e.meeting_id),'[]',result->'suggestedActions',finger) returning id into rid;
 insert into public.risk_history(risk_id,workspace_id,status,note) values(rid,e.workspace_id,'active','Detected from '||e.kind);
 end if;
 insert into public.risk_evidence(risk_id,event_id,workspace_id) values(rid,e.id,e.workspace_id) on conflict do nothing;
 end if;
 end if;
 for item in select value from jsonb_array_elements(impacts) loop
 if exists(select 1 from jsonb_array_elements_text(item->'affected_task_ids') a where not exists(select 1 from public.tasks where id=a.value::uuid and project_id=j.project_id and status<>'Done')) then raise exception 'Invalid impact scope';end if;
 update public.project_risks set affected_task_ids=array(select value::uuid from jsonb_array_elements_text(item->'affected_task_ids')),severity=item->>'severity',score=(item->>'score')::integer,explanations=item->'explanations',updated_at=now()
 where project_id=j.project_id and status in ('active','acknowledged') and source_task_id=(item->>'task_id')::uuid;
 end loop;
 update private.intelligence_jobs set state='done',lease_token=null,lease_until=null,error_message=null where id=j.id;return true;
end; $$;
commit;
