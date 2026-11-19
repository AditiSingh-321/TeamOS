begin;
-- Durable, read-only event history; existing approval/risk audit tables remain unchanged.
create table public.project_activity_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 project_id uuid, actor_user_id uuid references auth.users(id) on delete set null, actor_name text not null,
 event_type text not null, target_type text not null, target_id uuid, summary text not null,
 metadata jsonb not null default '{}', source_key text not null unique, created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade,
 unique(workspace_id,id)
);
create index activity_project_time on public.project_activity_events(project_id,created_at desc,id desc);
create index activity_workspace_time on public.project_activity_events(workspace_id,created_at desc,id desc);
create table public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 assignments boolean not null default true, mentions boolean not null default true, reminders boolean not null default true,
 risks boolean not null default true, approvals boolean not null default true, meetings boolean not null default true
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),recipient_user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,project_id uuid,
 actor_user_id uuid references auth.users(id) on delete set null,event_id uuid not null,
 type text not null check(type in ('assignment','mention','due_soon','overdue','risk','approval_pending','action_executed','meeting_action')),
 title text not null,body text not null,target_type text not null,target_id uuid,
 created_at timestamptz not null default clock_timestamp(),read_at timestamptz,
 unique(recipient_user_id,event_id,type),
 foreign key(workspace_id,event_id) references public.project_activity_events(workspace_id,id) on delete cascade,
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
create index notifications_recipient_time on public.notifications(recipient_user_id,created_at desc,id desc);
create index notifications_scope on public.notifications(workspace_id,project_id);
create index task_reminder_candidates on public.tasks(due_date,id) where assignee_id is not null and status<>'Done';
create index notifications_unread on public.notifications(recipient_user_id,workspace_id) where read_at is null;
-- One narrow invalidation row per scope. No task/comment contents are replicated.
create table public.collaboration_signals (
 scope_key text primary key, workspace_id uuid references public.workspaces(id) on delete cascade,
 project_id uuid references public.projects(id) on delete cascade,recipient_user_id uuid references auth.users(id) on delete cascade,
 event_id uuid not null default gen_random_uuid(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade,
 check(coalesce(((scope_key='w:'||workspace_id::text and project_id is null and recipient_user_id is null)
    or (scope_key='p:'||project_id::text and workspace_id is not null and recipient_user_id is null)
    or (scope_key='u:'||recipient_user_id::text and workspace_id is null and project_id is null)),false))
);
create index signals_workspace on public.collaboration_signals(workspace_id);
alter table public.project_activity_events enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.collaboration_signals enable row level security;
revoke all on public.project_activity_events,public.notifications,public.notification_preferences,public.collaboration_signals from public,anon,authenticated;
grant select on public.project_activity_events,public.notifications,public.notification_preferences,public.collaboration_signals to authenticated;
grant insert,update on public.notification_preferences to authenticated;
create policy activity_read on public.project_activity_events for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
create policy notification_read on public.notifications for select to authenticated using(recipient_user_id=auth.uid() and private.workspace_role_for(workspace_id) is not null);
create policy preferences_own on public.notification_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy signal_read on public.collaboration_signals for select to authenticated using(
 (recipient_user_id=auth.uid()) or (recipient_user_id is null and private.workspace_role_for(workspace_id) is not null)
);
create function private.signal_scope(wid uuid,pid uuid default null,uid uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if uid is not null then
  if not exists(select 1 from auth.users where id=uid) then return;end if;
  insert into public.collaboration_signals(scope_key,recipient_user_id) values('u:'||uid,uid)
  on conflict(scope_key) do update set event_id=gen_random_uuid(),updated_at=clock_timestamp();
 else
  if not exists(select 1 from public.workspaces where id=wid) then return; end if;
  insert into public.collaboration_signals(scope_key,workspace_id) values('w:'||wid,wid)
  on conflict(scope_key) do update set event_id=gen_random_uuid(),updated_at=clock_timestamp();
  if pid is not null and exists(select 1 from public.projects where id=pid and workspace_id=wid) then
   insert into public.collaboration_signals(scope_key,workspace_id,project_id) values('p:'||pid,wid,pid)
   on conflict(scope_key) do update set event_id=gen_random_uuid(),updated_at=clock_timestamp();
  end if;
 end if;
end;$$;
create function private.record_activity(wid uuid,pid uuid,kind text,target_kind text,target uuid,message text,details jsonb default '{}',dedup text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid; actor text;
begin
 if not exists(select 1 from public.workspaces where id=wid) or (pid is not null and not exists(select 1 from public.projects where id=pid and workspace_id=wid)) then return null; end if;
 select display_name into actor from public.workspace_members where workspace_id=wid and user_id=auth.uid();
 insert into public.project_activity_events(workspace_id,project_id,actor_user_id,actor_name,event_type,target_type,target_id,summary,metadata,source_key)
 values(wid,pid,auth.uid(),coalesce(actor,'TeamOS'),kind,target_kind,target,left(message,300),details,coalesce(dedup,gen_random_uuid()::text))
 on conflict(source_key) do nothing returning id into eid;
 if eid is not null then perform private.signal_scope(wid,pid); end if;
 return eid;
end;$$;
create function private.notify_recipient(eid uuid,recipient uuid,kind text,message text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.project_activity_events; pref public.notification_preferences; enabled boolean;
begin
 select * into e from public.project_activity_events where id=eid;
 if not found or recipient is null or recipient=e.actor_user_id or not exists(select 1 from public.workspace_members where workspace_id=e.workspace_id and user_id=recipient) then return; end if;
 select * into pref from public.notification_preferences where user_id=recipient;
 enabled:=case kind when 'assignment' then pref.assignments when 'mention' then pref.mentions when 'due_soon' then pref.reminders when 'overdue' then pref.reminders when 'risk' then pref.risks when 'approval_pending' then pref.approvals when 'meeting_action' then pref.meetings else pref.approvals end;
 if enabled=false then return; end if;
 insert into public.notifications(recipient_user_id,workspace_id,project_id,actor_user_id,event_id,type,title,body,target_type,target_id)
 values(recipient,e.workspace_id,e.project_id,e.actor_user_id,e.id,kind,left(message,160),e.actor_name||': '||e.summary,e.target_type,e.target_id)
 on conflict(recipient_user_id,event_id,type) do nothing;
end;$$;
create function private.notification_signal() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.signal_scope(null,null,new.recipient_user_id);return new;end;$$;
create trigger notifications_signal after insert or update on public.notifications for each row execute function private.notification_signal();
create function public.mark_notifications_read(target_id uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.notifications set read_at=clock_timestamp() where recipient_user_id=auth.uid() and read_at is null
 and ($1 is null or id=$1) and private.workspace_role_for(workspace_id) is not null;
 get diagnostics n=row_count;return n;
end;$$;
-- Trigger every task change, including deletion/project moves; field metadata excludes descriptions.
create function private.collaboration_task() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tasks; eid uuid; kind text; description text;
begin
 if tg_op='DELETE' then t:=old;kind:='task_deleted';description:='Deleted task: '||t.title;
 elsif tg_op='INSERT' then t:=new;kind:='task_created';description:='Created task: '||t.title;
 else
  t:=new;
  if (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new; end if;
  kind:=case when new.status is distinct from old.status then case when new.status='Done' then 'task_completed' else 'task_status_changed' end when new.assignee_id is distinct from old.assignee_id then 'task_assigned' else 'task_updated' end;
  description:=case when new.status is distinct from old.status then t.title||': '||old.status::text||' → '||(to_jsonb(new)->>'status') else 'Updated task: '||t.title end;
  if old.project_id is distinct from new.project_id then perform private.signal_scope(old.workspace_id,old.project_id); end if;
 end if;
 eid:=private.record_activity(t.workspace_id,t.project_id,kind,'task',t.id,description,
 case when tg_op='UPDATE' then jsonb_build_object('previous_status',old.status,'status',new.status) else '{}'::jsonb end);
 if tg_op='INSERT' or (tg_op='UPDATE' and new.assignee_id is distinct from old.assignee_id) then
  perform private.notify_recipient(eid,t.assignee_id,'assignment','A task was assigned to you');
 end if;
 return coalesce(new,old);
end;$$;
create trigger tasks_collaboration after insert or update or delete on public.tasks for each row execute function private.collaboration_task();
create function private.collaboration_comment() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid; eid uuid;
begin
 select project_id into pid from public.tasks where id=new.task_id;
 eid:=private.record_activity(new.workspace_id,pid,'task_commented','task',new.task_id,'Added a task comment','{}','comment:'||new.id);
 return new;
end;$$;
create trigger comments_collaboration after insert on public.task_comments for each row execute function private.collaboration_comment();
-- Structured mentions are explicit recipients, never inferred from @text.
alter table public.task_comments add column client_request_id uuid;
create unique index comments_request on public.task_comments(author_id,client_request_id) where client_request_id is not null;
alter table public.task_comments add constraint comments_workspace_id_key unique(workspace_id,id);
create table public.task_comment_mentions (
 comment_id uuid not null references public.task_comments(id) on delete cascade,workspace_id uuid not null,
 user_id uuid not null, primary key(comment_id,user_id),
 foreign key(workspace_id,comment_id) references public.task_comments(workspace_id,id) on delete cascade,
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table public.task_comment_mentions enable row level security;
revoke all on public.task_comment_mentions from public,anon,authenticated;
grant select on public.task_comment_mentions to authenticated;
create policy mentions_read on public.task_comment_mentions for select to authenticated using(private.workspace_role_for(workspace_id) is not null);
create function public.post_task_comment(target_task uuid,content text,mentioned_users uuid[],request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.tasks;cid uuid;uid uuid;eid uuid;
begin
 if auth.uid() is null or request_id is null then raise exception 'Sign in and retry';end if;
 select * into t from public.tasks where id=target_task for share;
 if not found or private.workspace_role_for(t.workspace_id) is null then raise exception 'Task unavailable'; end if;
 if length(btrim(content)) not between 1 and 2000 or content is null or cardinality(mentioned_users)>10 or exists(select 1 from unnest(mentioned_users) m where m is null or not exists(select 1 from public.workspace_members where workspace_id=t.workspace_id and user_id=m)) then raise exception 'Invalid comment or mentioned member';end if;
 insert into public.task_comments(workspace_id,task_id,body,client_request_id) values(t.workspace_id,t.id,content,request_id)
 on conflict(author_id,client_request_id) where client_request_id is not null do nothing returning id into cid;
 if cid is null then
  select id into cid from public.task_comments where author_id=auth.uid() and client_request_id=request_id and task_id=t.id and body=content;
  if cid is null then raise exception 'Request already used for another comment'; end if;return cid;
 end if;
 select id into eid from public.project_activity_events where source_key='comment:'||cid;
 foreach uid in array coalesce(mentioned_users,'{}') loop
  insert into public.task_comment_mentions values(cid,t.workspace_id,uid) on conflict do nothing;
  perform private.notify_recipient(eid,uid,'mention','You were mentioned in a task comment');
 end loop;
 return cid;
end;$$;
-- Other committed project resources reuse one narrow trigger; no duplicate audit replacement.
create function private.collaboration_resource() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=coalesce(to_jsonb(new),to_jsonb(old));wid uuid;pid uuid;tid uuid;eid uuid;kind text;message text;recipient uuid;manager record;result_task public.tasks;
begin
 wid:=(row_data->>'workspace_id')::uuid;pid:=(row_data->>'project_id')::uuid;tid:=(row_data->>'id')::uuid;
 if tg_table_name='projects' then
  if tg_op='DELETE' then perform private.signal_scope(wid);return old;end if;
  pid:=tid;kind:='project_'||lower(tg_op);message:='Project '||lower(tg_op)||': '||(row_data->>'name');
  if tg_op='UPDATE' and (to_jsonb(new)-'updated_at'-'progress')=(to_jsonb(old)-'updated_at'-'progress') then perform private.signal_scope(wid,pid);return new;end if;
 elsif tg_table_name='task_dependencies' then
  kind:='dependency_'||lower(tg_op);message:='Task dependency '||lower(tg_op);tid:=(row_data->>'project_id')::uuid;
 elsif tg_table_name='project_documents' then
  if tg_op='UPDATE' and new.processing_status is not distinct from old.processing_status then return new;end if;
  kind:='document_'||lower(tg_op);message:=case when tg_op='INSERT' then 'Uploaded document: ' else 'Document updated: ' end||(row_data->>'filename');
 elsif tg_table_name='meetings' then
  kind:='meeting_'||lower(tg_op);message:='Meeting '||lower(tg_op)||': '||(row_data->>'title');
 elsif tg_table_name='meeting_analyses' then
  if tg_op='UPDATE' and (to_jsonb(new)->>'status') is not distinct from (to_jsonb(old)->>'status') then return new;end if;
  select project_id into pid from public.meetings where id=new.meeting_id;tid:=new.meeting_id;
  kind:='meeting_analysis';message:='Meeting analysis: '||new.status;
 elsif tg_table_name='project_risks' then
  if tg_op='UPDATE' and (to_jsonb(new)->>'status') is not distinct from (to_jsonb(old)->>'status') and (to_jsonb(new)->>'severity') is not distinct from (to_jsonb(old)->>'severity') then perform private.signal_scope(wid,pid);return new;end if;
  kind:='risk_'||new.status;message:='Risk '||(row_data->>'status')||': '||(row_data->>'title');
 elsif tg_table_name='action_proposals' then
  if tg_op='UPDATE' and (to_jsonb(new)->>'status') is not distinct from (to_jsonb(old)->>'status') then perform private.signal_scope(wid,pid);return new;end if;
  kind:='action_'||new.status;message:='Action '||(row_data->>'status')||': '||(row_data->>'action_type');
 else return coalesce(new,old);end if;
 eid:=private.record_activity(wid,pid,kind,case tg_table_name when 'task_dependencies' then 'project' when 'meeting_analyses' then 'meeting' when 'project_risks' then 'risk' when 'action_proposals' then 'approval' when 'project_documents' then 'document' when 'meetings' then 'meeting' else 'project' end,tid,message);
 if tg_table_name='project_risks' and row_data->>'status'='active' and (tg_op='INSERT' or (to_jsonb(old)->>'status') not in ('active','acknowledged') or (row_data->>'severity' in ('High','Critical') and (to_jsonb(old)->>'severity') not in ('High','Critical'))) then
  for manager in select user_id from public.workspace_members where workspace_id=wid and role in ('owner','admin') union select assignee_id from public.tasks where id=new.source_task_id and assignee_id is not null loop
   perform private.notify_recipient(eid,manager.user_id,'risk','A project risk needs attention');
  end loop;
 elsif tg_table_name='action_proposals' then
  if row_data->>'status'='pending' then
   for manager in select user_id from public.workspace_members where workspace_id=wid and role in ('owner','admin') loop perform private.notify_recipient(eid,manager.user_id,'approval_pending','An action needs your approval');end loop;
  elsif row_data->>'status'='executed' then
   perform private.notify_recipient(eid,new.requested_by,'action_executed','An approved action was executed');
   select * into result_task from public.tasks where id=coalesce((new.result->>'task_id')::uuid,(new.payload->>'taskId')::uuid);
   perform private.notify_recipient(eid,result_task.assignee_id,case when new.source_type='meeting' then 'meeting_action' else 'action_executed' end,case when new.source_type='meeting' then 'Approved meeting work was assigned to you' else 'An approved action updated your task' end);
  end if;
 end if;
 return coalesce(new,old);
end;$$;
create trigger projects_collaboration after insert or update or delete on public.projects for each row execute function private.collaboration_resource();
create trigger dependencies_collaboration after insert or delete on public.task_dependencies for each row execute function private.collaboration_resource();
create trigger documents_collaboration after insert or update or delete on public.project_documents for each row execute function private.collaboration_resource();
create trigger meetings_collaboration after insert or update or delete on public.meetings for each row execute function private.collaboration_resource();
create trigger analyses_collaboration after insert or update on public.meeting_analyses for each row execute function private.collaboration_resource();
create trigger risks_collaboration after insert or update on public.project_risks for each row execute function private.collaboration_resource();
create trigger proposals_collaboration after insert or update on public.action_proposals for each row execute function private.collaboration_resource();
-- Membership changes wake clients; revoked clients cannot SELECT subsequent protected signals.
create function private.collaboration_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.signal_scope(coalesce(new.workspace_id,old.workspace_id));perform private.signal_scope(null,null,coalesce(new.user_id,old.user_id));return coalesce(new,old);end;$$;
create trigger members_collaboration after insert or update or delete on public.workspace_members for each row execute function private.collaboration_membership();
-- UTC calendar reminders: stable task/assignee/date/type keys; bounded worker batches.
create function public.scan_task_reminders(due_window_days integer default 1) returns integer
language plpgsql security definer set search_path='' as $$
declare t public.tasks;kind text;eid uuid;n integer:=0;today date:=(now() at time zone 'UTC')::date;
begin
 if due_window_days is null or due_window_days not between 0 and 14 then raise exception 'Reminder window must be 0â€“14 days';end if;
 for t in select * from public.tasks where assignee_id is not null and status<>'Done' and due_date<=today+due_window_days
 and not exists(select 1 from public.project_activity_events where source_key='reminder:'||tasks.id||':'||tasks.assignee_id||':'||tasks.due_date||':'||case when tasks.due_date<today then 'overdue' else 'due_soon' end)
 order by due_date,id limit 100 for update skip locked loop
  kind:=case when t.due_date<today then 'overdue' else 'due_soon' end;
  eid:=private.record_activity(t.workspace_id,t.project_id,'task_'||kind,'task',t.id,case when kind='overdue' then 'Task overdue: ' else 'Task due soon: ' end||t.title,'{}','reminder:'||t.id||':'||t.assignee_id||':'||t.due_date||':'||kind);
  perform private.notify_recipient(eid,t.assignee_id,kind,case when kind='overdue' then 'Your assigned task is overdue' else 'Your assigned task is due soon' end);n:=n+1;
 end loop;return n;
end;$$;
-- Read-state changes have no client UPDATE grant and cannot forge event content.
revoke execute on function public.mark_notifications_read(uuid),public.post_task_comment(uuid,text,uuid[],uuid),public.scan_task_reminders(integer) from public,anon,authenticated;
grant execute on function public.mark_notifications_read(uuid),public.post_task_comment(uuid,text,uuid[],uuid) to authenticated;
grant execute on function public.scan_task_reminders(integer) to service_role;
revoke all on function private.signal_scope(uuid,uuid,uuid),private.record_activity(uuid,uuid,text,text,uuid,text,jsonb,text),private.notify_recipient(uuid,uuid,text,text),private.notification_signal(),private.collaboration_task(),private.collaboration_comment(),private.collaboration_resource(),private.collaboration_membership() from public,anon,authenticated,service_role;
-- Publish only the content-free signal table. Deletions of business rows generate new signals.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='collaboration_signals') then
  alter publication supabase_realtime add table public.collaboration_signals;
 end if;
end;$$;


-- Read-only join authorization also lets Postgres Changes use private-only tenants.
create function public.can_read_collaboration_channel(target_topic text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare scope_type text;target uuid;
begin
 if target_topic !~ '^sync:[uwp]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 scope_type:=substring(target_topic from 6 for 1);target:=substring(target_topic from 8)::uuid;
 if scope_type='u' then return target=auth.uid();end if;
 if scope_type='w' then return private.workspace_role_for(target) is not null;end if;
 return exists(select 1 from public.projects where id=target and private.workspace_role_for(workspace_id) is not null);
end;$$;
revoke all on function public.can_read_collaboration_channel(text) from public,anon,authenticated;
grant execute on function public.can_read_collaboration_channel(text) to authenticated;

-- Presence uses private channels; Broadcast publication is deliberately not granted.
create function public.can_view_project_presence(target_topic text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare pid uuid;
begin
 if target_topic !~ '^project:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 pid:=substring(target_topic from 9)::uuid;
 return exists(select 1 from public.projects where id=pid and private.workspace_role_for(workspace_id) is not null);
end;$$;
revoke all on function public.can_view_project_presence(text) from public,anon,authenticated;
grant execute on function public.can_view_project_presence(text) to authenticated;
do $$begin
 if to_regclass('realtime.messages') is not null then
  execute 'create policy teamos_sync_join on realtime.messages for select to authenticated using (extension = ''broadcast'' and public.can_read_collaboration_channel(realtime.topic()))';
  execute 'create policy teamos_presence_read on realtime.messages for select to authenticated using (extension = ''presence'' and public.can_view_project_presence(realtime.topic()))';
  execute 'create policy teamos_presence_publish on realtime.messages for insert to authenticated with check (extension = ''presence'' and public.can_view_project_presence(realtime.topic()))';
 end if;
end;$$;
commit;
