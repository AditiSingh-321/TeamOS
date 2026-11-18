begin;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('f3000000-0000-4000-8000-000000000001', 'phase5-owner@example.com', now(), '{}'),
 ('f3000000-0000-4000-8000-000000000002', 'phase5-member@example.com', now(), '{}'),
 ('f3000000-0000-4000-8000-000000000003', 'phase5-outsider@example.com', now(), '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000001"}', true);
select set_config('phase5.workspace', public.create_workspace('Graph workspace')::text, true);

do $$
declare
  w uuid := current_setting('phase5.workspace')::uuid;
  p uuid;
  other_project uuid;
  a uuid;
  b uuid;
  c uuid;
  other_task uuid;
  invitation uuid;
begin
  insert into public.projects (workspace_id, name) values (w, 'Dependency graph') returning id into p;
  insert into public.projects (workspace_id, name) values (w, 'Other project') returning id into other_project;
  insert into public.tasks (workspace_id, project_id, title) values (w, p, 'A') returning id into a;
  insert into public.tasks (workspace_id, project_id, title) values (w, p, 'B') returning id into b;
  insert into public.tasks (workspace_id, project_id, title) values (w, p, 'C') returning id into c;
  insert into public.tasks (workspace_id, project_id, title) values (w, other_project, 'Other') returning id into other_task;
  perform set_config('phase5.project', p::text, true);
  perform set_config('phase5.a', a::text, true);
  perform set_config('phase5.b', b::text, true);
  perform set_config('phase5.c', c::text, true);

  perform public.add_task_dependency(w, p, a, b);
  perform public.add_task_dependency(w, p, b, c);
  perform public.add_task_dependency(w, p, a, b);
  if (select count(*) from public.task_dependencies where project_id = p) <> 2 then raise exception 'Edge insertion was not idempotent'; end if;
  begin
    perform public.add_task_dependency(w, p, a, a);
    raise exception 'Self dependency accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.add_task_dependency(w, p, c, a);
    raise exception 'Cycle accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.add_task_dependency(w, p, other_task, a);
    raise exception 'Cross project edge accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.tasks set project_id = other_project where id = a;
    raise exception 'Task with edges moved to another project';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.task_dependencies (workspace_id, project_id, source_id, target_id) values (w, p, c, a);
    raise exception 'Direct edge insert bypassed validation';
  exception when insufficient_privilege then null;
  end;
  insert into public.workspace_invitations (workspace_id, email, role)
  values (w, 'phase5-member@example.com', 'member') returning id into invitation;
  perform set_config('phase5.invitation', invitation::text, true);
end $$;

select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000002"}', true);
select public.accept_workspace_invitation(current_setting('phase5.invitation')::uuid);
do $$
declare
  w uuid := current_setting('phase5.workspace')::uuid;
  p uuid := current_setting('phase5.project')::uuid;
  a uuid := current_setting('phase5.a')::uuid;
  b uuid := current_setting('phase5.b')::uuid;
  owned uuid;
begin
  if (select count(*) from public.task_dependencies where project_id = p) <> 2 then raise exception 'Member could not view graph'; end if;
  begin
    perform public.remove_task_dependency(w, p, a, b);
    raise exception 'Member changed another creator dependency';
  exception when insufficient_privilege then null;
  end;
  insert into public.tasks (workspace_id, project_id, title) values (w, p, 'Member owned') returning id into owned;
  perform public.add_task_dependency(w, p, b, owned);
  if not public.remove_task_dependency(w, p, b, owned) then raise exception 'Creator could not remove dependency'; end if;
  delete from public.tasks where id = owned;
end $$;

select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000003"}', true);
do $$
begin
  if exists (select 1 from public.task_dependencies) then raise exception 'Outsider read private graph'; end if;
  begin
    perform public.add_task_dependency(current_setting('phase5.workspace')::uuid, current_setting('phase5.project')::uuid,
      current_setting('phase5.a')::uuid, current_setting('phase5.c')::uuid);
    raise exception 'Outsider added dependency';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000001"}', true);
do $$
declare
  w uuid := current_setting('phase5.workspace')::uuid;
  p uuid := current_setting('phase5.project')::uuid;
  a uuid := current_setting('phase5.a')::uuid;
  b uuid := current_setting('phase5.b')::uuid;
  c uuid := current_setting('phase5.c')::uuid;
begin
  delete from public.tasks where id = b;
  if exists (select 1 from public.task_dependencies where project_id = p) then raise exception 'Task deletion retained edges'; end if;
  perform public.add_task_dependency(w, p, a, c);
  delete from public.projects where id = p;
  if exists (select 1 from public.task_dependencies where project_id = p) then raise exception 'Project deletion retained edges'; end if;
  if (select count(*) from public.tasks where id in (a, c) and project_id is null) <> 2 then raise exception 'Project deletion did not retain tasks'; end if;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.add_task_dependency(null, null, null, null);
    raise exception 'Anonymous dependency mutation allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
