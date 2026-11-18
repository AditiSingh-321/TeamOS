begin;

create schema if not exists private;
grant usage on schema private to authenticated;

create type public.workspace_role as enum ('owner', 'admin', 'member');
create type public.project_status as enum ('Planning', 'On track', 'At risk');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create unique index workspace_one_owner on public.workspace_members (workspace_id) where role = 'owner';
create index workspace_members_by_user on public.workspace_members (user_id, workspace_id);
create index workspaces_by_creator on public.workspaces (created_by);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (
    email = lower(btrim(email)) and char_length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  role public.workspace_role not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique (workspace_id, email)
);

create index workspace_invitations_by_email on public.workspace_invitations (email);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  status public.project_status not null default 'Planning',
  deadline date check (deadline between date '0001-01-01' and date '9999-12-31'),
  progress smallint not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_by_workspace_and_update on public.projects (workspace_id, updated_at desc, id);

create function private.touch_project()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
for each row execute function private.touch_project();

create function private.workspace_role_for(target_workspace uuid)
returns public.workspace_role language sql stable security definer set search_path = '' as $$
  select m.role from public.workspace_members m
  where m.workspace_id = target_workspace and m.user_id = (select auth.uid());
$$;

create function private.confirmed_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;

create function private.member_display_name()
returns text language sql stable security definer set search_path = '' as $$
  select left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'TeamOS member'
  ), 100)
  from auth.users u where u.id = (select auth.uid());
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.projects enable row level security;

revoke all on public.workspaces, public.workspace_members, public.workspace_invitations, public.projects from public, anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.workspace_invitations, public.projects to authenticated;
grant insert (workspace_id, name, description, status, deadline, progress),
  update (name, description, status, deadline, progress), delete on public.projects to authenticated;
grant insert (workspace_id, email, role), delete on public.workspace_invitations to authenticated;

create policy workspaces_read on public.workspaces for select to authenticated
using (private.workspace_role_for(id) is not null);

create policy workspace_members_read on public.workspace_members for select to authenticated
using (private.workspace_role_for(workspace_id) is not null);

create policy workspace_invitations_read on public.workspace_invitations for select to authenticated using (
  private.workspace_role_for(workspace_id) in ('owner', 'admin')
  or (expires_at > now() and email = (select private.confirmed_email()))
);

create policy workspace_invitations_create on public.workspace_invitations for insert to authenticated with check (
  private.workspace_role_for(workspace_id) = 'owner'
  or (private.workspace_role_for(workspace_id) = 'admin' and role = 'member')
);

create policy workspace_invitations_revoke on public.workspace_invitations for delete to authenticated using (
  private.workspace_role_for(workspace_id) = 'owner'
  or (private.workspace_role_for(workspace_id) = 'admin' and role = 'member')
);

create policy projects_read on public.projects for select to authenticated
using (private.workspace_role_for(workspace_id) is not null);

create policy projects_create on public.projects for insert to authenticated
with check (private.workspace_role_for(workspace_id) in ('owner', 'admin'));

create policy projects_update on public.projects for update to authenticated
using (private.workspace_role_for(workspace_id) in ('owner', 'admin'))
with check (private.workspace_role_for(workspace_id) in ('owner', 'admin'));

create policy projects_delete on public.projects for delete to authenticated
using (private.workspace_role_for(workspace_id) in ('owner', 'admin'));

-- These RPCs combine related writes in a single transaction.
create function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  workspace uuid;
begin
  if actor is null then
    raise exception 'Sign in to create a workspace' using errcode = '42501';
  end if;
  insert into public.workspaces (name, created_by)
  values (btrim(workspace_name), actor) returning id into workspace;
  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (workspace, actor, 'owner', private.member_display_name());
  return workspace;
end;
$$;

create function public.list_my_workspace_invitations()
returns table (id uuid, workspace_name text, role public.workspace_role)
language sql stable security definer set search_path = '' as $$
  select i.id, w.name, i.role
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  where i.email = (select private.confirmed_email()) and i.expires_at > now()
  order by i.created_at desc, i.id;
$$;

create function public.accept_workspace_invitation(invitation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  invited public.workspace_invitations;
begin
  -- Deletion claims the invitation atomically and rolls back if the membership write fails.
  delete from public.workspace_invitations i
  where i.id = invitation and i.email = private.confirmed_email() and i.expires_at > now()
  returning i.* into invited;

  if not found or actor is null then
    raise exception 'Invitation is unavailable' using errcode = '42501';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (invited.workspace_id, actor, invited.role, private.member_display_name())
  on conflict (workspace_id, user_id) do nothing;
  return invited.workspace_id;
end;
$$;

create function public.set_workspace_member_role(
  target_workspace uuid, target_user uuid, new_role public.workspace_role
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.workspace_role_for(target_workspace) is distinct from 'owner'::public.workspace_role
     or new_role is null or new_role = 'owner' then
    raise exception 'Only the workspace owner can assign member and admin roles' using errcode = '42501';
  end if;
  update public.workspace_members set role = new_role
  where workspace_id = target_workspace and user_id = target_user and role <> 'owner';
  if not found then
    raise exception 'Member role cannot be changed' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.touch_project(), private.workspace_role_for(uuid),
  private.confirmed_email(), private.member_display_name() from public, anon, authenticated;
grant execute on function private.workspace_role_for(uuid), private.confirmed_email() to authenticated;

revoke execute on function public.create_workspace(text), public.list_my_workspace_invitations(), public.accept_workspace_invitation(uuid),
  public.set_workspace_member_role(uuid, uuid, public.workspace_role) from public, anon, authenticated;
grant execute on function public.create_workspace(text), public.list_my_workspace_invitations(), public.accept_workspace_invitation(uuid),
  public.set_workspace_member_role(uuid, uuid, public.workspace_role) to authenticated;

commit;
