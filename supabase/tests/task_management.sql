-- Run after both Phase 3 and Phase 4 migrations in a disposable Supabase database.
begin;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('f2000000-0000-4000-8000-000000000001', 'phase4-owner@example.com', now(), '{}'),
  ('f2000000-0000-4000-8000-000000000002', 'phase4-assignee@example.com', now(), '{}'),
  ('f2000000-0000-4000-8000-000000000003', 'phase4-outsider@example.com', now(), '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000003"}', true);
select set_config('phase4.other', public.create_workspace('Other workspace')::text, true);
with project as (
  insert into public.projects (workspace_id, name) values (current_setting('phase4.other')::uuid, 'Other project') returning id
)
select set_config('phase4.other_project', id::text, true) from project;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000001"}', true);
select set_config('phase4.workspace', public.create_workspace('Task workspace')::text, true);
with invitation as (
  insert into public.workspace_invitations (workspace_id, email, role)
  values (current_setting('phase4.workspace')::uuid, 'phase4-assignee@example.com', 'member') returning id
)
select set_config('phase4.invitation', id::text, true) from invitation;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000002"}', true);
select public.accept_workspace_invitation(current_setting('phase4.invitation')::uuid);
do $$
declare
  own_task uuid;
begin
  insert into public.tasks (workspace_id, title) values (current_setting('phase4.workspace')::uuid, 'Member task')
    returning id into own_task;
  update public.tasks set title = 'Member edited task' where id = own_task;
  if not found then raise exception 'Creator could not edit own task'; end if;
  delete from public.tasks where id = own_task;
  if not found then raise exception 'Creator could not delete own task'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000001"}', true);
do $$
declare
  w uuid := current_setting('phase4.workspace')::uuid;
  p uuid;
  t uuid;
  stamp timestamptz;
begin
  insert into public.projects (workspace_id, name) values (w, 'Task project') returning id into p;
  insert into public.tasks (workspace_id, project_id, assignee_id, title, priority, due_date)
  values (w, p, 'f2000000-0000-4000-8000-000000000002', 'Assigned task', 'High', '2026-12-01')
  returning id, updated_at into t, stamp;
  perform set_config('phase4.task', t::text, true);
  perform set_config('phase4.project', p::text, true);
  perform set_config('phase4.stamp', stamp::text, true);
  begin
    update public.tasks set assignee_id = 'f2000000-0000-4000-8000-000000000003' where id = t;
    raise exception 'Cross-workspace assignment succeeded';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.tasks set project_id = current_setting('phase4.other_project')::uuid where id = t;
    raise exception 'Cross-workspace project link succeeded';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.tasks set workspace_id = current_setting('phase4.other')::uuid where id = t;
    raise exception 'Direct task move across workspaces succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.tasks set title = ' ' where id = t;
    raise exception 'Blank task title was accepted';
  exception when check_violation then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000002"}', true);
do $$
declare
  w uuid := current_setting('phase4.workspace')::uuid;
  t uuid := current_setting('phase4.task')::uuid;
  stamp timestamptz := current_setting('phase4.stamp')::timestamptz;
  moved timestamptz;
begin
  update public.tasks set title = 'Unauthorized edit' where id = t;
  if found then raise exception 'Assignee edited another creator''s task'; end if;
  delete from public.tasks where id = t;
  if found then raise exception 'Assignee deleted another creator''s task'; end if;

  moved := public.move_task(w, t, stamp, 'Review');
  if moved is null then raise exception 'Assignee could not move task'; end if;
  if public.move_task(w, t, stamp, 'Done') is not null then raise exception 'Stale move overwrote the current status'; end if;
  if public.move_task(w, t, moved, 'Done') is null then raise exception 'Task could not move to Done'; end if;

  insert into public.task_comments (workspace_id, task_id, body) values (w, t, 'A workspace comment');
  if not exists (select 1 from public.task_comments where task_id = t and author_id = auth.uid()) then
    raise exception 'Comment author or visibility is wrong';
  end if;
  if public.workspace_task_counts(w) <> '{"total":1,"done":1}'::jsonb then raise exception 'Dashboard count is wrong'; end if;
  begin
    insert into public.task_comments (workspace_id, task_id, author_id, body)
    values (w, t, 'f2000000-0000-4000-8000-000000000001', 'Forged author');
    raise exception 'Caller spoofed comment author';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000003"}', true);
do $$
declare
  w uuid := current_setting('phase4.workspace')::uuid;
  t uuid := current_setting('phase4.task')::uuid;
begin
  if exists (select 1 from public.tasks where id = t)
    or exists (select 1 from public.task_comments where task_id = t)
    or public.workspace_task_counts(w) <> '{"total":0,"done":0}'::jsonb then
    raise exception 'Private task data leaked';
  end if;
  if public.move_task(w, t, current_setting('phase4.stamp')::timestamptz, 'To Do') is not null then
    raise exception 'Outsider moved task';
  end if;
  begin
    insert into public.tasks (workspace_id, title) values (w, 'Unauthorized task');
    raise exception 'Outsider created task';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.task_comments (workspace_id, task_id, body) values (w, t, 'Unauthorized comment');
    raise exception 'Outsider created comment';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.task_comments (workspace_id, task_id, body)
    values (current_setting('phase4.other')::uuid, t, 'Mismatched scope');
    raise exception 'Cross-workspace comment link succeeded';
  exception when foreign_key_violation then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000001"}', true);
do $$
declare
  t uuid := current_setting('phase4.task')::uuid;
begin
  delete from public.projects where id = current_setting('phase4.project')::uuid;
  if not exists (select 1 from public.tasks where id = t and project_id is null) then
    raise exception 'Task was not retained after project deletion';
  end if;
  delete from public.tasks where id = t;
  if not found then raise exception 'Owner could not delete task'; end if;
  if exists (select 1 from public.task_comments where task_id = t) then
    raise exception 'Deleted task retained comments';
  end if;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.tasks;
    raise exception 'Anonymous task access succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.workspace_task_counts(current_setting('phase4.workspace')::uuid);
    raise exception 'Anonymous aggregate access succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
