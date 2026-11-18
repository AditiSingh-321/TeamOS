begin;
create table public.action_requests(
 id uuid primary key,workspace_id uuid not null,project_id uuid not null,requested_by uuid references auth.users(id) on delete set null,
 prompt text not null check(length(prompt) between 5 and 2000),status text not null default 'pending' check(status in ('pending','generated','failed')),
 generation_token uuid not null default gen_random_uuid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create index action_requests_project on public.action_requests(project_id,created_at desc);
create table public.action_proposals(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,requested_by uuid references auth.users(id) on delete set null,
 source_type text not null check(source_type in ('request','risk','meeting')),source_id uuid,
 source_analysis_id uuid references public.meeting_analyses(id) on delete set null,source_revision integer,source_snapshot jsonb not null,
 action_type text not null check(action_type in ('CREATE_TASK','UPDATE_TASK_STATUS','UPDATE_TASK_PRIORITY','UPDATE_TASK_DUE_DATE','ASSIGN_TASK','ADD_TASK_COMMENT')),
 payload jsonb not null,expected_state jsonb not null,reason text not null check(length(reason) between 1 and 800),
 status text not null default 'pending' check(status in ('pending','approved','rejected','executed','failed','cancelled')),
 revision integer not null default 1,idempotency_key text not null,
 approved_by uuid references auth.users(id) on delete set null,approved_at timestamptz,executed_at timestamptz,
 result jsonb,error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(project_id,idempotency_key),foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create index proposals_workspace_status on public.action_proposals(workspace_id,project_id,status,created_at desc);
create table public.action_execution_logs(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references public.action_proposals(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,actor_id uuid references auth.users(id) on delete set null,
 action_type text not null,outcome text not null,previous_state jsonb,resulting_state jsonb,error_message text,created_at timestamptz not null default now()
);
create index execution_logs_proposal on public.action_execution_logs(proposal_id,created_at);
alter table public.action_requests enable row level security;
revoke all on public.action_requests from public,anon,authenticated;
grant select on public.action_requests to authenticated;
create policy action_requests_read on public.action_requests for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
alter table public.action_proposals enable row level security;
revoke all on public.action_proposals from public,anon,authenticated;
grant select on public.action_proposals to authenticated;
create policy action_proposals_read on public.action_proposals for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
alter table public.action_execution_logs enable row level security;
revoke all on public.action_execution_logs from public,anon,authenticated;
grant select on public.action_execution_logs to authenticated;
create policy action_execution_logs_read on public.action_execution_logs for select to authenticated using(private.workspace_role_for(workspace_id) is not null);

create function private.action_snapshot(pid uuid,kind text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tasks;member uuid;field text;allowed text[];
begin
 if jsonb_typeof(payload)<>'object' then raise exception 'Invalid action payload';end if;
 if kind='CREATE_TASK' then allowed:=array['title','description','priority','due_date','assignee_id'];
 elsif kind='UPDATE_TASK_STATUS' then allowed:=array['taskId','status'];
 elsif kind='UPDATE_TASK_PRIORITY' then allowed:=array['taskId','priority'];
 elsif kind='UPDATE_TASK_DUE_DATE' then allowed:=array['taskId','due_date'];
 elsif kind='ASSIGN_TASK' then allowed:=array['taskId','assignee_id'];
 elsif kind='ADD_TASK_COMMENT' then allowed:=array['taskId','body'];
 else raise exception 'Unsupported action';end if;
 if exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed))) or exists(select 1 from unnest(allowed) k where not(payload ? k)) then raise exception 'Unexpected action fields';end if;
 if kind='CREATE_TASK' and (coalesce(length(btrim(payload->>'title')),0) not between 1 and 120 or coalesce(length(payload->>'description'),99999)>5000 or coalesce(payload->>'priority','') not in ('Low','Medium','High')) then raise exception 'Invalid task';end if;
 if kind='ADD_TASK_COMMENT' and coalesce(length(btrim(payload->>'body')),0) not between 1 and 2000 then raise exception 'Invalid comment';end if;
 if kind='UPDATE_TASK_STATUS' and (payload->>'status' is null or payload->>'status' not in ('To Do','In Progress','Review','Done')) then raise exception 'Invalid status';end if;
 if kind='UPDATE_TASK_PRIORITY' and (payload->>'priority' is null or coalesce(payload->>'priority','') not in ('Low','Medium','High')) then raise exception 'Invalid priority';end if;
 if payload ? 'due_date' and payload->>'due_date' is not null then
 if not((payload->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') or (payload->>'due_date')::date not between date '0001-01-01' and date '9999-12-31' then raise exception 'Invalid due date';end if;
 end if;
 if payload->>'assignee_id' is not null then
 select wm.user_id into member from public.workspace_members wm join public.projects p on p.workspace_id=wm.workspace_id where p.id=pid and wm.user_id=(payload->>'assignee_id')::uuid;
 if member is null then raise exception 'Assignee outside workspace' using errcode='42501';end if;
 end if;
 if kind='CREATE_TASK' then return '{}'::jsonb;end if;
 select * into t from public.tasks where id=(payload->>'taskId')::uuid and project_id=pid;
 if t.id is null then raise exception 'Task outside project' using errcode='42501';end if;
 field:=case kind when 'UPDATE_TASK_STATUS' then 'status' when 'UPDATE_TASK_PRIORITY' then 'priority' when 'UPDATE_TASK_DUE_DATE' then 'due_date' when 'ASSIGN_TASK' then 'assignee_id' else null end;
 return jsonb_build_object('task_id',t.id,'task_title',t.title,'field',field,'value',case when field is null then null else to_jsonb(t)->field end);
end; $$;
create function private.proposal_source(pid uuid,source_kind text,source uuid,analysis_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare value jsonb;
begin
 if source_kind='request' then select jsonb_build_object('id',r.id,'prompt',r.prompt,'requested_by',r.requested_by,'created_at',r.created_at) into value from public.action_requests r where r.id=source and r.project_id=pid;
 elsif source_kind='risk' then select to_jsonb(r) into value from public.project_risks r where r.id=source and r.project_id=pid and r.status in ('active','acknowledged');
 elsif source_kind='meeting' then select jsonb_build_object('meeting_id',m.id,'meeting_title',m.title,'meeting_revision',m.revision,'analysis_id',a.id,'analysis_revision',a.revision,'reviewed',a.reviewed,'source_snapshot',a.source_snapshot) into value
 from public.meetings m join public.meeting_analyses a on a.meeting_id=m.id where m.id=source and m.project_id=pid and a.id=analysis_id and m.revision=a.meeting_revision and m.status='reviewed' and a.status='reviewed';
 end if;
 if value is null then raise exception 'Source unavailable or no longer reviewed' using errcode='40001';end if;return value;
end; $$;
create function private.insert_action_proposal(pid uuid,source_kind text,source uuid,analysis_id uuid,kind text,payload jsonb,reason text,origin text) returns uuid language plpgsql security definer set search_path='' as $$
declare wid uuid;snapshot jsonb;state jsonb;existing uuid;previous public.action_proposals;rid uuid;
begin
 select workspace_id into wid from public.projects where id=pid;
 if wid is null or private.workspace_role_for(wid) is null then raise exception 'Project access required' using errcode='42501';end if;
 select id into existing from public.action_proposals where project_id=pid and idempotency_key=origin;
 if existing is not null then
 if source_kind='meeting' then
 select * into previous from public.action_proposals where id=existing for update;
 snapshot:=private.proposal_source(pid,source_kind,source,analysis_id);
 if previous.status in ('pending','failed') and (previous.source_revision is distinct from (snapshot->>'analysis_revision')::integer or previous.source_analysis_id is distinct from analysis_id) then
 state:=private.action_snapshot(pid,kind,payload);
 update public.action_proposals set payload=insert_action_proposal.payload,expected_state=state,source_analysis_id=analysis_id,source_revision=(snapshot->>'analysis_revision')::integer,source_snapshot=snapshot,reason=insert_action_proposal.reason,status='pending',error_message=null,revision=revision+1,updated_at=now() where id=existing;
 insert into public.action_execution_logs(proposal_id,workspace_id,actor_id,action_type,outcome,previous_state,resulting_state) values(existing,wid,auth.uid(),kind,'refreshed_source',previous.payload,payload);
 end if;end if;
 return existing;end if;
 snapshot:=private.proposal_source(pid,source_kind,source,analysis_id);state:=private.action_snapshot(pid,kind,payload);
 if kind='CREATE_TASK' and exists(select 1 from public.tasks where project_id=pid and regexp_replace(lower(btrim(title)),'[[:space:]]+',' ','g')=regexp_replace(lower(btrim(payload->>'title')),'[[:space:]]+',' ','g')) then raise exception 'A matching task exists. Review the existing task instead.' using errcode='23505';end if;

 insert into public.action_proposals(workspace_id,project_id,requested_by,source_type,source_id,source_analysis_id,source_revision,source_snapshot,action_type,payload,expected_state,reason,idempotency_key)
 values(wid,pid,auth.uid(),source_kind,source,analysis_id,(snapshot->>'analysis_revision')::integer,snapshot,kind,payload,state,reason,origin)
 on conflict(project_id,idempotency_key) do nothing returning id into rid;
 if rid is null then select id into rid from public.action_proposals where project_id=pid and idempotency_key=origin;end if;
 return rid;
end; $$;
create function public.reserve_action_request(target_project uuid,request_id uuid,prompt text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.action_requests;wid uuid;
begin
 select workspace_id into wid from public.projects where id=target_project;
 if wid is null or private.workspace_role_for(wid) is null then raise exception 'Project access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,10));
 select * into r from public.action_requests where id=request_id for update;
 if r.id is not null then
 if r.project_id<>target_project or r.requested_by<>auth.uid() or r.prompt<>prompt then raise exception 'Request access denied' using errcode='42501';end if;
 if r.status='generated' then return jsonb_build_object('generate',false);end if;
 if r.status='pending' and r.updated_at>now()-interval '3 minutes' then raise exception 'Request still processing';end if;
 end if;
 perform public.reserve_rag_question(target_project);
 insert into public.action_requests(id,workspace_id,project_id,requested_by,prompt) values(request_id,wid,target_project,auth.uid(),prompt)
 on conflict(id) do update set status='pending',generation_token=gen_random_uuid(),updated_at=now() returning * into r;
 return jsonb_build_object('generate',true,'token',r.generation_token);
end; $$;
create function public.finish_action_request(request_id uuid,token uuid,actions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.action_requests;item jsonb;ids jsonb:='[]';rid uuid;idx integer:=0;
begin
 select * into r from public.action_requests where id=request_id for update;
 if r.id is null or private.workspace_role_for(r.workspace_id) is null or r.requested_by<>auth.uid() then raise exception 'Request access denied' using errcode='42501';end if;
 if r.status='generated' then return jsonb_build_object('saved',true);end if;
 if r.status<>'pending' or r.generation_token<>token then raise exception 'Request changed' using errcode='40001';end if;
 if jsonb_typeof(actions)<>'array' or jsonb_array_length(actions)>8 then raise exception 'Invalid proposals';end if;
 for item in select value from jsonb_array_elements(actions) loop
 rid:=private.insert_action_proposal(r.project_id,'request',r.id,null,item->'action'->>'type',item->'action'->'payload',item->>'reason','request:'||r.id||':'||idx);
 ids:=ids||jsonb_build_array(rid);idx:=idx+1;
 end loop;
 update public.action_requests set status='generated',updated_at=now() where id=r.id;return jsonb_build_object('proposalIds',ids);
end; $$;
create function public.fail_action_request(request_id uuid,token uuid) returns void language sql security definer set search_path='' as $$
 update public.action_requests set status='failed',updated_at=now() where id=request_id and requested_by=auth.uid() and generation_token=token and status='pending' and private.workspace_role_for(workspace_id) is not null;
$$;
create function public.propose_risk_followup(target_risk uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.project_risks;
begin
 select * into r from public.project_risks where id=target_risk;
 if r.id is null or private.workspace_role_for(r.workspace_id) is null then raise exception 'Risk access required' using errcode='42501';end if;
 return private.insert_action_proposal(r.project_id,'risk',r.id,null,'CREATE_TASK',jsonb_build_object('title',left('Follow up: '||r.title,120),'description',left(r.description||E'\nSource: '||(r.evidence->>'text'),5000),'priority','Medium','due_date',null,'assignee_id',null),'Follow up on this reviewed risk; no deadline changes are automatic.','risk:'||r.id||':followup');
end; $$;
create function public.propose_meeting_actions(target_analysis uuid,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.meeting_analyses;m public.meetings;item jsonb;t public.tasks;origin text;rid uuid;ids jsonb:='[]';kind text;payload jsonb;
begin
 select * into a from public.meeting_analyses where id=target_analysis;select * into m from public.meetings where id=a.meeting_id;
 if m.id is null or private.workspace_role_for(m.workspace_id) is null then raise exception 'Meeting access required' using errcode='42501';end if;
 if a.revision<>expected_revision or a.status<>'reviewed' or m.revision<>a.meeting_revision then raise exception 'Meeting review changed' using errcode='40001';end if;
 for item in select value from jsonb_array_elements(a.reviewed->'actionItems') loop
 if item->>'target'='ignore' then continue;end if;
 origin:='meeting:'||m.id||':'||md5(item->>'evidence');
 if item->>'target'='create' then
 payload:=jsonb_build_object('title',item->>'title','description',item->>'description','priority',item->>'priority','due_date',item->>'dueDate','assignee_id',item->>'assigneeId');
 rid:=private.insert_action_proposal(m.project_id,'meeting',m.id,a.id,'CREATE_TASK',payload,'Reviewed meeting action item: '||left(item->>'evidence',700),origin||':CREATE_TASK');ids:=ids||jsonb_build_array(rid);
 elsif item->>'target'='update' then
 select * into t from public.tasks where id=(item->>'taskId')::uuid and project_id=m.project_id;
 if t.id is null then raise exception 'Choose an existing project task';end if;
 for kind,payload in select 'UPDATE_TASK_PRIORITY',jsonb_build_object('taskId',t.id,'priority',item->>'priority') where t.priority::text is distinct from item->>'priority'
 union all select 'UPDATE_TASK_DUE_DATE',jsonb_build_object('taskId',t.id,'due_date',item->>'dueDate') where item->>'dueDate' is not null and t.due_date::text is distinct from item->>'dueDate'
 union all select 'ADD_TASK_COMMENT',jsonb_build_object('taskId',t.id,'body',left((item->>'description')||E'\nMeeting evidence: '||(item->>'evidence'),2000)) where length(item->>'description')>0
 union all select 'ASSIGN_TASK',jsonb_build_object('taskId',t.id,'assignee_id',item->>'assigneeId') where item->>'assigneeId' is not null and t.assignee_id::text is distinct from item->>'assigneeId'
 loop rid:=private.insert_action_proposal(m.project_id,'meeting',m.id,a.id,kind,payload,'Reviewed meeting action item: '||left(item->>'evidence',700),origin||':'||t.id||':'||kind);ids:=ids||jsonb_build_array(rid);end loop;
 end if;
 end loop;
 for item in select value from jsonb_array_elements(a.reviewed->'taskUpdates') loop
 if coalesce((item->>'ignore')::boolean,false) or item->>'suggestedStatus' is null then continue;end if;
 if item->>'taskId' is null then raise exception 'Choose a task for the status suggestion';end if;
 rid:=private.insert_action_proposal(m.project_id,'meeting',m.id,a.id,'UPDATE_TASK_STATUS',jsonb_build_object('taskId',item->>'taskId','status',item->>'suggestedStatus'),'Reviewed status suggestion: '||left(item->>'evidence',700),'meeting:'||m.id||':'||md5(item->>'evidence')||':'||(item->>'taskId')||':UPDATE_TASK_STATUS');ids:=ids||jsonb_build_array(rid);
 end loop;
 return ids;
end; $$;
create function private.apply_project_task_action(pid uuid,kind text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects;t public.tasks;changed timestamptz;comment_id uuid;
begin
 select * into p from public.projects where id=pid;
 perform private.action_snapshot(pid,kind,payload);
 if kind='CREATE_TASK' then
 if exists(select 1 from public.tasks where project_id=pid and regexp_replace(lower(btrim(title)),'[[:space:]]+',' ','g')=regexp_replace(lower(btrim(payload->>'title')),'[[:space:]]+',' ','g')) then raise exception 'A matching task already exists';end if;
 insert into public.tasks(workspace_id,project_id,title,description,priority,due_date,assignee_id,created_by)
 values(p.workspace_id,p.id,payload->>'title',payload->>'description',(payload->>'priority')::public.task_priority,(payload->>'due_date')::date,(payload->>'assignee_id')::uuid,auth.uid()) returning * into t;
 else
 select * into t from public.tasks where id=(payload->>'taskId')::uuid and project_id=pid for update;
 case kind
 when 'UPDATE_TASK_STATUS' then
 if t.status::text<>payload->>'status' then changed:=public.move_task(t.workspace_id,t.id,t.updated_at,(payload->>'status')::public.task_status);if changed is null then raise exception 'Task changed' using errcode='40001';end if;end if;
 when 'UPDATE_TASK_PRIORITY' then update public.tasks set priority=(payload->>'priority')::public.task_priority where id=t.id;
 when 'UPDATE_TASK_DUE_DATE' then update public.tasks set due_date=(payload->>'due_date')::date where id=t.id;
 when 'ASSIGN_TASK' then update public.tasks set assignee_id=(payload->>'assignee_id')::uuid where id=t.id;
 when 'ADD_TASK_COMMENT' then insert into public.task_comments(workspace_id,task_id,body,author_id) values(t.workspace_id,t.id,payload->>'body',auth.uid()) returning id into comment_id;
 else raise exception 'Unsupported action';end case;
 select * into t from public.tasks where id=t.id;
 end if;
 return jsonb_build_object('task_id',t.id,'task',to_jsonb(t),'comment_id',comment_id);
end; $$;
create function public.edit_action_proposal(target_proposal uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p public.action_proposals;snapshot jsonb;
begin
 select * into p from public.action_proposals where id=target_proposal for update;
 if p.id is null or private.workspace_role_for(p.workspace_id) is null or not(private.workspace_role_for(p.workspace_id) in ('owner','admin') or p.requested_by=auth.uid()) then raise exception 'Proposal access required' using errcode='42501';end if;
 if p.revision<>expected_revision or p.status not in ('pending','failed') then raise exception 'Proposal changed' using errcode='40001';end if;
 perform private.proposal_source(p.project_id,p.source_type,p.source_id,p.source_analysis_id);
 snapshot:=private.action_snapshot(p.project_id,p.action_type,payload);
 update public.action_proposals set payload=edit_action_proposal.payload,expected_state=snapshot,status='pending',error_message=null,revision=revision+1,updated_at=now() where id=p.id;
 insert into public.action_execution_logs(proposal_id,workspace_id,actor_id,action_type,outcome,previous_state,resulting_state) values(p.id,p.workspace_id,auth.uid(),p.action_type,'edited',p.payload,payload);
end; $$;
create function public.review_action_proposal(target_proposal uuid,expected_revision integer,operation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.action_proposals;live jsonb;output jsonb;source jsonb;failure text;
begin
 -- A project lock serializes approvals, including two different CREATE_TASK proposals.
 select * into p from public.action_proposals where id=target_proposal;
 if p.id is null or private.workspace_role_for(p.workspace_id) is null or private.workspace_role_for(p.workspace_id) not in ('owner','admin') then raise exception 'Manager access required' using errcode='42501';end if;
 perform 1 from public.projects where id=p.project_id for update;
 select * into p from public.action_proposals where id=target_proposal for update;
 if p.status='executed' and operation='approve' then return jsonb_build_object('status','executed','result',p.result);end if;
 if p.revision<>expected_revision or p.status<>'pending' then raise exception 'Proposal changed; review again' using errcode='40001';end if;
 if operation in ('reject','cancel') then
 update public.action_proposals set status=case when operation='reject' then 'rejected' else 'cancelled' end,revision=revision+1,updated_at=now() where id=p.id;
 insert into public.action_execution_logs(proposal_id,workspace_id,actor_id,action_type,outcome) values(p.id,p.workspace_id,auth.uid(),p.action_type,case when operation='reject' then 'rejected' else 'cancelled' end);
 return jsonb_build_object('status',case when operation='reject' then 'rejected' else 'cancelled' end);end if;
 if operation<>'approve' then raise exception 'Unsupported approval operation';end if;
 update public.action_proposals set status='approved',approved_by=auth.uid(),approved_at=now() where id=p.id;
 begin
 source:=private.proposal_source(p.project_id,p.source_type,p.source_id,p.source_analysis_id);
 if p.source_type='meeting' and ((source->>'analysis_revision')::integer<>p.source_revision or source->>'meeting_revision' is distinct from p.source_snapshot->>'meeting_revision') then raise exception 'Meeting review changed' using errcode='40001';end if;
 if p.payload->>'taskId' is not null then perform 1 from public.tasks where id=(p.payload->>'taskId')::uuid and project_id=p.project_id for update;end if;
 live:=private.action_snapshot(p.project_id,p.action_type,p.payload);
 if live->>'field' is not null and live->'value' is distinct from p.expected_state->'value' then raise exception 'Task changed; review current values' using errcode='40001';end if;
 output:=private.apply_project_task_action(p.project_id,p.action_type,p.payload);
 update public.action_proposals set status='executed',result=output,executed_at=now(),error_message=null,revision=revision+1,updated_at=now() where id=p.id;
 insert into public.action_execution_logs(proposal_id,workspace_id,actor_id,action_type,outcome,previous_state,resulting_state) values(p.id,p.workspace_id,auth.uid(),p.action_type,'executed',p.expected_state,output);
 if p.source_type='meeting' and p.source_analysis_id is not null then
 insert into private.intelligence_jobs(kind,source_id,project_id) values('meeting_index',p.source_analysis_id,p.project_id)
 on conflict(kind,source_id) do update set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null;
 end if;
 exception when others then
 failure:=case when sqlstate='40001' then 'Task or source changed. Refresh the source or edit and review the proposal again.' when sqlstate='42501' then 'A referenced task or assignee is no longer available.' else 'Execution failed. Check the task, possible duplicates, and proposal fields before retrying.' end;
 update public.action_proposals set status='failed',error_message=failure,revision=revision+1,updated_at=now() where id=p.id;
 insert into public.action_execution_logs(proposal_id,workspace_id,actor_id,action_type,outcome,previous_state,error_message) values(p.id,p.workspace_id,auth.uid(),p.action_type,'failed',p.expected_state,failure);
 return jsonb_build_object('status','failed','error',failure);
 end;
 return jsonb_build_object('status','executed','result',output);
end; $$;
revoke all on function public.reserve_action_request(uuid,uuid,text) from public,anon;
grant execute on function public.reserve_action_request(uuid,uuid,text) to authenticated;
revoke all on function public.finish_action_request(uuid,uuid,jsonb) from public,anon;
grant execute on function public.finish_action_request(uuid,uuid,jsonb) to authenticated;
revoke all on function public.fail_action_request(uuid,uuid) from public,anon;
grant execute on function public.fail_action_request(uuid,uuid) to authenticated;
revoke all on function public.propose_risk_followup(uuid) from public,anon;
grant execute on function public.propose_risk_followup(uuid) to authenticated;
revoke all on function public.propose_meeting_actions(uuid,integer) from public,anon;
grant execute on function public.propose_meeting_actions(uuid,integer) to authenticated;
revoke all on function public.edit_action_proposal(uuid,integer,jsonb) from public,anon;
grant execute on function public.edit_action_proposal(uuid,integer,jsonb) to authenticated;
revoke all on function public.review_action_proposal(uuid,integer,text) from public,anon;
grant execute on function public.review_action_proposal(uuid,integer,text) to authenticated;
revoke all on function private.action_snapshot(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.proposal_source(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.insert_action_proposal(uuid,text,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function private.apply_project_task_action(uuid,text,jsonb) from public,anon,authenticated,service_role;

create table private.intelligence_ai_budget(project_id uuid not null references public.projects(id) on delete cascade,created_at timestamptz not null default now());
create index intelligence_budget_project on private.intelligence_ai_budget(project_id,created_at);
alter table private.intelligence_ai_budget enable row level security;
create function public.take_intelligence_budget(target_project uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(target_project::text,11));
 if (select count(*) from private.intelligence_ai_budget where project_id=target_project and created_at>now()-interval '1 hour')>=60 or
 (select count(*) from private.intelligence_ai_budget where project_id=target_project and created_at>now()-interval '1 day')>=300 then return false;end if;
 delete from private.intelligence_ai_budget where created_at<now()-interval '1 day';
 insert into private.intelligence_ai_budget(project_id) values(target_project);return true;
end; $$;
revoke all on function public.take_intelligence_budget(uuid) from public,anon,authenticated;
grant execute on function public.take_intelligence_budget(uuid) to service_role;
create function public.intelligence_job_summary(target_project uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare wid uuid;
begin
 select workspace_id into wid from public.projects where id=target_project;
 if wid is null or private.workspace_role_for(wid) is null then raise exception 'Project access required' using errcode='42501';end if;
 return (select jsonb_build_object('pending',count(*) filter(where state in ('queued','running')),'failed',count(*) filter(where state='failed')) from private.intelligence_jobs where project_id=target_project);
end; $$;
create function public.retry_intelligence_jobs(target_project uuid) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 select workspace_id into wid from public.projects where id=target_project;
 if wid is null or private.workspace_role_for(wid) is null or private.workspace_role_for(wid) not in ('owner','admin') then raise exception 'Manager access required' using errcode='42501';end if;
 perform public.reserve_rag_question(target_project);
 with changed as(update private.intelligence_jobs set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null,error_message=null where project_id=target_project and state='failed' returning source_id,kind)
 update public.meeting_analyses set status='queued',error_message=null where id in(select source_id from changed where kind='meeting_analysis');
end; $$;
revoke all on function public.intelligence_job_summary(uuid),public.retry_intelligence_jobs(uuid) from public,anon;
grant execute on function public.intelligence_job_summary(uuid),public.retry_intelligence_jobs(uuid) to authenticated;
create or replace function public.claim_intelligence_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;e public.project_risk_events;
begin
 select * into j from private.intelligence_jobs where (state='queued' and available_at<=now()) or (state='running' and lease_until<now()) order by available_at,id for update skip locked limit 1;
 if j.id is null then return null;end if;
 if j.attempts>=3 then update private.intelligence_jobs set state='failed',error_message='Attempts exhausted; request reanalysis.' where id=j.id;update public.meeting_analyses set status='failed',error_message='Analysis attempts exhausted. Retry analysis.' where id=j.source_id and j.kind='meeting_analysis';return null;end if;
 update private.intelligence_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 select * into e from public.project_risk_events where id=j.source_id;
 return jsonb_build_object('job',to_jsonb(j),'event',to_jsonb(e),'context',public.intelligence_context(j.project_id),'analysis',(select to_jsonb(a) from public.meeting_analyses a where a.id=j.source_id),'meeting',(select to_jsonb(m) from public.meetings m join public.meeting_analyses a on a.meeting_id=m.id where a.id=j.source_id),'executed_actions',(select coalesce(jsonb_agg(jsonb_build_object('action_type',ap.action_type,'payload',ap.payload,'result',ap.result,'executed_at',ap.executed_at)),'[]') from public.action_proposals ap join public.meeting_analyses ma on ma.meeting_id=ap.source_id where ma.id=j.source_id and ap.project_id=j.project_id and ap.status='executed' and ap.source_type='meeting'),'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',wm.user_id,'display_name',wm.display_name)),'[]') from public.workspace_members wm join public.projects p on p.workspace_id=wm.workspace_id where p.id=j.project_id));
end; $$;
create or replace function private.enqueue_risk_event(wid uuid,pid uuid,tid uuid,event_kind text,body text,event_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
 if pid is null or not exists(select 1 from public.projects where id=pid and workspace_id=wid) then return null;end if;
 insert into public.project_risk_events(workspace_id,project_id,source_task_id,kind,evidence,fingerprint)
 values(wid,pid,tid,event_kind,left(body,12000),event_key) on conflict(fingerprint) do nothing returning id into eid;
 if eid is not null then insert into private.intelligence_jobs(kind,source_id,project_id) values('risk_event',eid,pid);end if;return eid;
end; $$;
create function private.deleted_task_risk_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.enqueue_risk_event(old.workspace_id,old.project_id,null,'task_deleted','Task deleted; refresh project risk impact.','deleted-task:'||old.id);return old;
end; $$;
create trigger deleted_tasks_risk_event after delete on public.tasks for each row execute function private.deleted_task_risk_event();
revoke all on function private.deleted_task_risk_event() from public,anon,authenticated;
create or replace function private.task_risk_event() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tasks; pid uuid; wid uuid;
begin
 if tg_table_name='task_comments' then
 select * into t from public.tasks where id=new.task_id;
 if new.body ~* '\m(block(ed|er)?|stuck|cannot|waiting|missing|delay(ed)?|approval|credentials)\M' then
 perform private.enqueue_risk_event(t.workspace_id,t.project_id,t.id,'comment',new.body,'comment:'||new.id); end if;
 elsif tg_table_name='tasks' then
 if new.project_id is distinct from old.project_id then perform private.enqueue_risk_event(old.workspace_id,old.project_id,null,'task_moved','Task moved; refresh former project impact.','move:'||old.id||':'||new.updated_at);end if;
 if new.project_id is not null and (new.status is distinct from old.status or new.due_date is distinct from old.due_date or new.is_blocked is distinct from old.is_blocked or new.priority is distinct from old.priority or new.project_id is distinct from old.project_id) then
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
create or replace function public.save_meeting(target_project uuid,meeting_id uuid,expected_revision integer,input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.meetings;wid uuid;
begin
 select workspace_id into wid from public.projects where id=target_project;
 if wid is null or private.workspace_role_for(wid) is null then raise exception 'Project access required' using errcode='42501';end if;
 perform 1 from public.projects where id=target_project for update;
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
create or replace function public.delete_meeting(target_meeting uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.projects where id=(select project_id from public.meetings where id=target_meeting) for update;
 if not private.can_edit_meeting(target_meeting) then raise exception 'Meeting access required' using errcode='42501';end if;
 update private.intelligence_jobs set state='done',lease_token=null,lease_until=null where source_id in(select id from public.meeting_analyses where meeting_id=target_meeting);
 delete from public.meetings where id=target_meeting and revision=expected_revision;
 if not found then raise exception 'Meeting changed' using errcode='40001';end if;
end; $$;
create or replace function public.queue_meeting_analysis(target_meeting uuid,expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.meetings;a public.meeting_analyses;
begin
 perform 1 from public.projects where id=(select project_id from public.meetings where id=target_meeting) for update;
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
create or replace function public.save_reviewed_meeting(target_analysis uuid,expected_revision integer,reviewed jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a public.meeting_analyses;m public.meetings;item jsonb;eid uuid;
begin
 perform 1 from public.projects where id=(select meeting_lock.project_id from public.meetings meeting_lock join public.meeting_analyses analysis_lock on analysis_lock.meeting_id=meeting_lock.id where analysis_lock.id=target_analysis) for update;
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
create or replace function public.finish_meeting_analysis(job_id uuid,token uuid,draft jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;a public.meeting_analyses;m public.meetings;
begin
 select * into j from private.intelligence_jobs where id=job_id;
 perform 1 from public.projects where id=j.project_id for update;
 select * into j from private.intelligence_jobs where id=job_id for update;
 if j.kind<>'meeting_analysis' or j.state<>'running' or j.lease_token is distinct from token or j.lease_until<now() then return false;end if;
 select * into a from public.meeting_analyses where id=j.source_id for update;
 select * into m from public.meetings where id=a.meeting_id;
 if m.id is null or m.revision<>a.meeting_revision then update private.intelligence_jobs set state='done' where id=j.id;return false;end if;
 if jsonb_typeof(draft)<>'object' or octet_length(draft::text)>60000 then raise exception 'Invalid analysis';end if;
 update public.meeting_analyses set draft=finish_meeting_analysis.draft,status='draft',revision=revision+1,updated_at=now() where id=a.id;
 update private.intelligence_jobs set state='done',lease_token=null,lease_until=null where id=j.id;return true;
end; $$;
create or replace function public.finish_meeting_index(job_id uuid,token uuid,expected_revision integer,chunks jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.intelligence_jobs;a public.meeting_analyses;m public.meetings;c jsonb;
begin
 select * into j from private.intelligence_jobs where id=job_id;
 perform 1 from public.projects where id=j.project_id for update;
 select * into j from private.intelligence_jobs where id=job_id for update;
 if j.kind<>'meeting_index' or j.state<>'running' or j.lease_token is distinct from token or j.lease_until<now() then return false;end if;
 select * into a from public.meeting_analyses where id=j.source_id for update;select * into m from public.meetings where id=a.meeting_id;
 if a.revision<>expected_revision or a.status<>'reviewed' or m.id is null or m.revision<>a.meeting_revision or m.status<>'reviewed' then update private.intelligence_jobs set state='done',lease_token=null,lease_until=null where id=j.id;return false;end if;
 if jsonb_typeof(chunks)<>'array' or jsonb_array_length(chunks) not between 1 and 100 then raise exception 'Invalid meeting chunks';end if;
 delete from public.document_chunks where meeting_id=m.id;
 for c in select value from jsonb_array_elements(chunks) loop
 insert into public.document_chunks(workspace_id,project_id,meeting_id,source_revision,chunk_index,content,content_hash,embedding,embedding_model,page_number,section_title)
 values(m.workspace_id,m.project_id,m.id,m.revision,(c->>'chunk_index')::integer,c->>'content',c->>'content_hash',(c->>'embedding')::extensions.vector,c->>'embedding_model',null,c->>'section_title');
 end loop;
 update private.intelligence_jobs set state='done',lease_token=null,lease_until=null where id=j.id;return true;
end; $$;
create function private.cancel_meeting_proposals() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.action_proposals;
begin
 for p in update public.action_proposals set status='cancelled',revision=revision+1,error_message='Source meeting deleted.',updated_at=now() where source_type='meeting' and source_id=old.id and status in ('pending','failed') returning * loop
 insert into public.action_execution_logs(proposal_id,workspace_id,actor_id,action_type,outcome,error_message) values(p.id,p.workspace_id,auth.uid(),p.action_type,'cancelled','Source meeting deleted.');
 end loop;return old;
end; $$;
create trigger meetings_cancel_proposals before delete on public.meetings for each row execute function private.cancel_meeting_proposals();
revoke all on function private.cancel_meeting_proposals() from public,anon,authenticated;
alter table public.meetings add constraint meetings_workspace_id_key unique(workspace_id,id);
alter table public.meeting_analyses add constraint meeting_analyses_scope_fkey foreign key(workspace_id,meeting_id) references public.meetings(workspace_id,id) on delete cascade;
alter table public.project_risks add constraint risks_workspace_id_key unique(workspace_id,id);
alter table public.project_risk_events add constraint risk_events_workspace_id_key unique(workspace_id,id);
alter table public.risk_history add constraint risk_history_scope_fkey foreign key(workspace_id,risk_id) references public.project_risks(workspace_id,id) on delete cascade;
alter table public.risk_evidence add constraint risk_evidence_scope_risk_fkey foreign key(workspace_id,risk_id) references public.project_risks(workspace_id,id) on delete cascade;
alter table public.risk_evidence add constraint risk_evidence_scope_event_fkey foreign key(workspace_id,event_id) references public.project_risk_events(workspace_id,id) on delete cascade;
alter table public.action_proposals add constraint proposals_workspace_id_key unique(workspace_id,id);
alter table public.action_execution_logs add constraint execution_logs_scope_fkey foreign key(workspace_id,proposal_id) references public.action_proposals(workspace_id,id) on delete cascade;
commit;
