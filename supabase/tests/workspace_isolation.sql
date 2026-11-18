-- Run after the Phase 3 migration in a disposable Supabase PostgreSQL database.
-- The test rolls back its data. RLS cases run with the actual authenticated/anon roles.
begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('f1000000-0000-4000-8000-000000000001', 'phase3-owner@example.com', now(), '{"full_name":"Owner Fixture"}'),
  ('f1000000-0000-4000-8000-000000000002', 'phase3-member@example.com', now(), '{}'),
  ('f1000000-0000-4000-8000-000000000003', 'phase3-outsider@example.com', now(), '{}'),
  ('f1000000-0000-4000-8000-000000000004', 'phase3-unverified@example.com', null, '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('teamtest.workspace', public.create_workspace('Phase 3 test workspace')::text, true);

do $$
declare
  w uuid := current_setting('teamtest.workspace')::uuid;
  p uuid;
  i uuid;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = w and role = 'owner') then
    raise exception 'Workspace creation did not create an owner';
  end if;
  insert into public.projects (workspace_id, name, progress) values (w, 'Private project', 20) returning id into p;
  perform set_config('teamtest.project', p::text, true);
  insert into public.workspace_invitations (workspace_id, email, role)
    values (w, 'phase3-member@example.com', 'member') returning id into i;
  perform set_config('teamtest.invite', i::text, true);
  insert into public.workspace_invitations (workspace_id, email, role)
    values (w, 'phase3-unverified@example.com', 'admin');
  insert into public.workspace_invitations (workspace_id, email, role)
    values (w, 'phase3-outsider@example.com', 'member') returning id into i;
  perform set_config('teamtest.expired', i::text, true);
end $$;

reset role;
update public.workspace_invitations set expires_at = now() - interval '1 day'
where id = current_setting('teamtest.expired')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('teamtest.other_workspace', public.create_workspace('Other private workspace')::text, true);

do $$
declare
  w uuid := current_setting('teamtest.workspace')::uuid;
  p uuid := current_setting('teamtest.project')::uuid;
begin
  if exists (select 1 from public.workspaces where id = w)
     or exists (select 1 from public.workspace_members where workspace_id = w)
     or exists (select 1 from public.workspace_invitations where workspace_id = w)
     or exists (select 1 from public.projects where id = p)
     or exists (select 1 from public.list_my_workspace_invitations()) then
    raise exception 'Workspace data leaked to an outsider';
  end if;
  begin
    perform public.accept_workspace_invitation(current_setting('teamtest.invite')::uuid);
    raise exception 'Outsider accepted another email invitation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.accept_workspace_invitation(current_setting('teamtest.expired')::uuid);
    raise exception 'Expired invitation could be accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.projects (workspace_id, name) values (w, 'Outsider project');
    raise exception 'Outsider inserted a project';
  exception when insufficient_privilege then null;
  end;
  update public.projects set name = 'Outsider edit' where id = p;
  if found then raise exception 'Outsider edited a project'; end if;
  delete from public.projects where id = p;
  if found then raise exception 'Outsider deleted a project'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.list_my_workspace_invitations()) then
    raise exception 'An unverified address was shown an invitation';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  w uuid := current_setting('teamtest.workspace')::uuid;
  p uuid := current_setting('teamtest.project')::uuid;
  i uuid := current_setting('teamtest.invite')::uuid;
begin
  if not exists (select 1 from public.list_my_workspace_invitations() where id = i) then
    raise exception 'Invitee did not receive their invitation';
  end if;
  if public.accept_workspace_invitation(i) <> w then
    raise exception 'Invitation returned the wrong workspace';
  end if;
  begin
    perform public.accept_workspace_invitation(i);
    raise exception 'Invitation was reusable';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from public.projects where id = p) then
    raise exception 'Member could not read a workspace project';
  end if;
  if exists (select 1 from public.workspaces where id = current_setting('teamtest.other_workspace')::uuid) then
    raise exception 'Member could read a different workspace';
  end if;
  update public.projects set name = 'Member edit' where id = p;
  if found then raise exception 'Member edited a project'; end if;
  delete from public.projects where id = p;
  if found then raise exception 'Member deleted a project'; end if;
  begin
    insert into public.projects (workspace_id, name) values (w, 'Member project');
    raise exception 'Member inserted a project';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_workspace_member_role(w, auth.uid(), 'admin');
    raise exception 'Member promoted their own role';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.set_workspace_member_role(current_setting('teamtest.workspace')::uuid, 'f1000000-0000-4000-8000-000000000002', 'admin');

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  w uuid := current_setting('teamtest.workspace')::uuid;
  p uuid := current_setting('teamtest.project')::uuid;
begin
  begin
    insert into public.workspace_invitations (workspace_id, email, role) values (w, 'phase3-escalation@example.com', 'admin');
    raise exception 'Admin issued an admin invitation';
  exception when insufficient_privilege then null;
  end;
  insert into public.workspace_invitations (workspace_id, email, role) values (w, 'phase3-allowed@example.com', 'member');
  begin
    update public.projects set workspace_id = current_setting('teamtest.other_workspace')::uuid where id = p;
    raise exception 'Admin was allowed to move a project between workspaces';
  exception when insufficient_privilege then null;
  end;
  update public.projects set progress = 50 where id = p;
  if not found then raise exception 'Admin could not update a workspace project'; end if;
  delete from public.projects where id = p;
  if not found then raise exception 'Admin could not delete a workspace project'; end if;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.create_workspace('Anonymous workspace');
    raise exception 'Anonymous user called create_workspace';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.projects;
    raise exception 'Anonymous user queried projects';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
