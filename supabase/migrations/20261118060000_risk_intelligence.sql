begin;
alter table public.tasks add column is_blocked boolean not null default false;
create table public.project_risk_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
 source_task_id uuid references public.tasks(id) on delete set null, kind text not null,
 evidence text not null default '', fingerprint text not null unique, created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create index risk_events_project on public.project_risk_events(project_id,created_at desc);
create table private.intelligence_jobs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('risk_event')),
 source_id uuid not null, project_id uuid not null references public.projects(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','running','done','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,error_message text,unique(kind,source_id)
);
create index intelligence_jobs_pending on private.intelligence_jobs(available_at) where state in ('queued','running');
create table public.project_risks (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 source_task_id uuid references public.tasks(id) on delete set null,
 source_event_id uuid not null references public.project_risk_events(id) on delete cascade,
 blocker_type text not null check(blocker_type in ('technical_issue','missing_information','external_dependency','resource_constraint','approval_pending','schedule_delay','other')),
 confirmation text not null check(confirmation in ('confirmed','possible')),
 title text not null,description text not null,severity text not null check(severity in ('Low','Medium','High','Critical')),
 score integer not null,confidence double precision check(confidence between 0 and 1),reported_delay_days integer,
 evidence jsonb not null,affected_task_ids uuid[] not null default '{}',explanations jsonb not null,recommendations jsonb not null,
 status text not null default 'active' check(status in ('active','acknowledged','resolved','dismissed')),
 fingerprint text not null,detected_at timestamptz not null default now(),resolved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create unique index risk_active_fingerprint on public.project_risks(project_id,fingerprint) where status in ('active','acknowledged');
create index risks_workspace on public.project_risks(workspace_id,project_id,status);
create table public.risk_history (
 id uuid primary key default gen_random_uuid(),risk_id uuid not null references public.project_risks(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 status text not null,actor_id uuid references auth.users(id) on delete set null,note text not null,created_at timestamptz not null default now()
);
create table public.risk_evidence (
 risk_id uuid not null references public.project_risks(id) on delete cascade,
 event_id uuid not null references public.project_risk_events(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade, primary key(risk_id,event_id)
);
alter table public.project_risk_events enable row level security;
revoke all on public.project_risk_events from public,anon,authenticated;
grant select on public.project_risk_events to authenticated;
create policy project_risk_events_read on public.project_risk_events for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
alter table public.project_risks enable row level security;
revoke all on public.project_risks from public,anon,authenticated;
grant select on public.project_risks to authenticated;
create policy project_risks_read on public.project_risks for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
alter table public.risk_history enable row level security;
revoke all on public.risk_history from public,anon,authenticated;
grant select on public.risk_history to authenticated;
create policy risk_history_read on public.risk_history for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
alter table public.risk_evidence enable row level security;
revoke all on public.risk_evidence from public,anon,authenticated;
grant select on public.risk_evidence to authenticated;
create policy risk_evidence_read on public.risk_evidence for select to authenticated using(private.workspace_role_for(workspace_id) is not null);

alter table private.intelligence_jobs enable row level security;
create function private.enqueue_risk_event(wid uuid,pid uuid,tid uuid,event_kind text,body text,event_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
 if pid is null then return null; end if;
 insert into public.project_risk_events(workspace_id,project_id,source_task_id,kind,evidence,fingerprint)
 values(wid,pid,tid,event_kind,left(body,12000),event_key) on conflict(fingerprint) do nothing returning id into eid;
 if eid is not null then insert into private.intelligence_jobs(kind,source_id,project_id) values('risk_event',eid,pid); end if;
 return eid;
end; $$;
create function private.task_risk_event() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tasks; pid uuid; wid uuid;
begin
 if tg_table_name='task_comments' then
 select * into t from public.tasks where id=new.task_id;
 if new.body ~* '\m(block(ed|er)?|stuck|cannot|waiting|missing|delay(ed)?|approval|credentials)\M' then
 perform private.enqueue_risk_event(t.workspace_id,t.project_id,t.id,'comment',new.body,'comment:'||new.id); end if;
 elsif tg_table_name='tasks' then
 if new.project_id is not null and (new.status is distinct from old.status or new.due_date is distinct from old.due_date or new.is_blocked is distinct from old.is_blocked or new.priority is distinct from old.priority) then
 perform private.enqueue_risk_event(new.workspace_id,new.project_id,new.id,
 case when new.is_blocked is distinct from old.is_blocked then 'blocked_flag' when new.due_date>old.due_date then 'deadline_extended' else 'task_changed' end,
 jsonb_build_object('before_status',old.status,'after_status',new.status,'before_due_date',old.due_date,'after_due_date',new.due_date)::text,'task:'||new.id||':'||new.updated_at);
 end if;
 else
 if tg_op='DELETE' then pid:=old.project_id;wid:=old.workspace_id;else pid:=new.project_id;wid:=new.workspace_id;end if;
 perform private.enqueue_risk_event(wid,pid,null,'dependency_changed','Project dependency graph changed','edge:'||gen_random_uuid());
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
create trigger comments_risk_event after insert on public.task_comments for each row execute function private.task_risk_event();
create trigger tasks_risk_event after update on public.tasks for each row execute function private.task_risk_event();
create trigger dependencies_risk_event after insert or delete on public.task_dependencies for each row execute function private.task_risk_event();
create function public.set_task_blocked(target_task uuid,expected_updated_at timestamptz,blocked boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.tasks set is_blocked=blocked where id=target_task and updated_at=expected_updated_at and project_id is not null
 and private.workspace_role_for(workspace_id) is not null and (private.workspace_role_for(workspace_id) in ('owner','admin') or created_by=auth.uid() or assignee_id=auth.uid());
 if not found then raise exception 'Task changed or access denied' using errcode='40001';end if;
end; $$;
create function public.scan_overdue_risks() returns void language plpgsql security definer set search_path='' as $$
declare t public.tasks;
begin
 for t in select * from public.tasks where project_id is not null and status<>'Done' and due_date<current_date
 and not exists(select 1 from public.project_risk_events e where e.fingerprint='overdue:'||tasks.id||':'||current_date) order by due_date,id limit 100 loop
 perform private.enqueue_risk_event(t.workspace_id,t.project_id,t.id,'overdue','Task due date is in the past','overdue:'||t.id||':'||current_date);
 end loop;
end; $$;
create function public.intelligence_context(target_project uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('project',to_jsonb(p),'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.tasks t where t.project_id=p.id),'[]'),
 'edges',coalesce((select jsonb_agg(jsonb_build_object('source_id',d.source_id,'target_id',d.target_id) order by d.source_id,d.target_id) from public.task_dependencies d where d.project_id=p.id),'[]'),
 'risks',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.project_risks r where r.project_id=p.id and r.status in ('active','acknowledged')),'[]')) from public.projects p where p.id=target_project;
$$;
create function public.claim_intelligence_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;e public.project_risk_events;
begin
 select * into j from private.intelligence_jobs where (state='queued' and available_at<=now()) or (state='running' and lease_until<now()) order by available_at,id for update skip locked limit 1;
 if j.id is null then return null;end if;
 if j.attempts>=3 then update private.intelligence_jobs set state='failed',error_message='Attempts exhausted; request reanalysis.' where id=j.id;return null;end if;
 update private.intelligence_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 select * into e from public.project_risk_events where id=j.source_id;
 return jsonb_build_object('job',to_jsonb(j),'event',to_jsonb(e),'context',public.intelligence_context(j.project_id));
end; $$;
create function public.fail_intelligence_job(job_id uuid,token uuid) returns void language sql security definer set search_path='' as $$
 update private.intelligence_jobs set state=case when attempts<3 then 'queued' else 'failed' end,available_at=now()+interval '1 minute',lease_token=null,lease_until=null,error_message='Analysis failed. Retry later or request reanalysis.'
 where id=job_id and state='running' and lease_token=token;
$$;
create function public.finish_risk_job(job_id uuid,token uuid,observed jsonb,result jsonb,impacts jsonb) returns boolean language plpgsql security definer set search_path='' as $$
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
 values(e.workspace_id,e.project_id,t.id,e.id,result->>'blockerType',result->>'state',t.title,result->>'reason','Low',0,(result->>'confidence')::double precision,(result->>'reportedDelayDays')::integer,jsonb_build_object('kind',e.kind,'text',e.evidence),'[]',result->'suggestedActions',finger) returning id into rid;
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
create function public.review_risk(target_risk uuid,next_status text,expected_updated_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare r public.project_risks;
begin
 select * into r from public.project_risks where id=target_risk for update;
 if r.id is null or private.workspace_role_for(r.workspace_id) not in ('owner','admin') or private.workspace_role_for(r.workspace_id) is null then raise exception 'Manager access required' using errcode='42501';end if;
 if r.updated_at<>expected_updated_at then raise exception 'Risk changed' using errcode='40001';end if;
 if next_status='reanalyze' then
 perform private.enqueue_risk_event(r.workspace_id,r.project_id,r.source_task_id,'reanalysis',r.evidence->>'text','reanalysis:'||gen_random_uuid());return;end if;
 if next_status not in ('acknowledged','resolved','dismissed') or r.status not in ('active','acknowledged') then raise exception 'Invalid risk transition';end if;
 update public.project_risks set status=next_status,resolved_at=case when next_status in ('resolved','dismissed') then now() else null end,updated_at=now() where id=r.id;
 insert into public.risk_history(risk_id,workspace_id,status,actor_id,note) values(r.id,r.workspace_id,next_status,auth.uid(),'Reviewed by a workspace manager');
end; $$;
revoke all on function public.scan_overdue_risks() from public,anon,authenticated;
grant execute on function public.scan_overdue_risks() to service_role;
revoke all on function public.intelligence_context(uuid) from public,anon,authenticated;
grant execute on function public.intelligence_context(uuid) to service_role;
revoke all on function public.claim_intelligence_job() from public,anon,authenticated;
grant execute on function public.claim_intelligence_job() to service_role;
revoke all on function public.fail_intelligence_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_intelligence_job(uuid,uuid) to service_role;
revoke all on function public.finish_risk_job(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_risk_job(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.set_task_blocked(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.set_task_blocked(uuid,timestamptz,boolean) to authenticated;
revoke all on function public.review_risk(uuid,text,timestamptz) from public,anon;
grant execute on function public.review_risk(uuid,text,timestamptz) to authenticated;
revoke all on function private.enqueue_risk_event(uuid,uuid,uuid,text,text,text),private.task_risk_event() from public,anon,authenticated;
create function public.risk_summary(target_workspace uuid,target_project uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with r as(select * from public.project_risks where workspace_id=target_workspace and (target_project is null or project_id=target_project) and status in ('active','acknowledged')),
 affected as(select distinct x from r,unnest(affected_task_ids) x),sources as(select distinct source_task_id as x from r where source_task_id is not null)
 select jsonb_build_object('active',(select count(*) from r),'high',(select count(*) from r where severity in ('High','Critical')),'blocked',(select count(*) from sources),'affected',(select count(*) from affected),
 'sources',coalesce((select jsonb_agg(x) from sources),'[]'),'affected_ids',coalesce((select jsonb_agg(x) from affected),'[]'));
$$;
revoke all on function public.risk_summary(uuid,uuid) from public,anon;
grant execute on function public.risk_summary(uuid,uuid) to authenticated;
commit;
