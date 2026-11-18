begin;

alter table public.tasks add constraint tasks_workspace_project_id_key unique (workspace_id, project_id, id);

create table public.task_dependencies (
  workspace_id uuid not null,
  project_id uuid not null,
  source_id uuid not null,
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (source_id, target_id),
  check (source_id <> target_id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, project_id, source_id)
    references public.tasks(workspace_id, project_id, id) on delete cascade,
  foreign key (workspace_id, project_id, target_id)
    references public.tasks(workspace_id, project_id, id) on delete cascade
);

create index task_dependencies_by_project on public.task_dependencies(workspace_id, project_id);
create index task_dependencies_by_target on public.task_dependencies(target_id);

alter table public.task_dependencies enable row level security;
revoke all on public.task_dependencies from public, anon, authenticated;
grant select on public.task_dependencies to authenticated;

create policy task_dependencies_read on public.task_dependencies for select to authenticated
using (private.workspace_role_for(workspace_id) is not null);

-- Source is the prerequisite. Target waits for source to finish.
-- Only these RPCs can mutate edges. A project lock serializes concurrent edits
-- before the cycle query takes its READ COMMITTED snapshot.
create function public.add_task_dependency(
  target_workspace uuid, target_project uuid, source_task uuid, dependent_task uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or private.workspace_role_for(target_workspace) is null then
    raise exception 'Workspace access required' using errcode = '42501';
  end if;
  perform 1 from public.projects where workspace_id = target_workspace and id = target_project for update;
  if not found then
    raise exception 'Project is unavailable' using errcode = '23503';
  end if;
  if source_task = dependent_task then
    raise exception 'A task cannot depend on itself' using errcode = '23514';
  end if;

  perform 1 from public.tasks
    where workspace_id = target_workspace and project_id = target_project and id = source_task for key share;
  if not found then raise exception 'Prerequisite must belong to this project' using errcode = '23503'; end if;

  perform 1 from public.tasks
    where workspace_id = target_workspace and project_id = target_project and id = dependent_task
      and (private.workspace_role_for(target_workspace) in ('owner', 'admin') or created_by = actor)
    for key share;
  if not found then
    raise exception 'Only managers or the dependent task creator can change its dependencies' using errcode = '42501';
  end if;

  if exists (
    with recursive downstream(id) as (
      select dependent_task
      union
      select d.target_id from public.task_dependencies d join downstream s on d.source_id = s.id
      where d.workspace_id = target_workspace and d.project_id = target_project
    )
    select 1 from downstream where id = source_task
  ) then
    raise exception 'Dependency would create a cycle' using errcode = '23514';
  end if;

  insert into public.task_dependencies (workspace_id, project_id, source_id, target_id)
  values (target_workspace, target_project, source_task, dependent_task)
  on conflict (source_id, target_id) do nothing;
end;
$$;

create function public.remove_task_dependency(
  target_workspace uuid, target_project uuid, source_task uuid, dependent_task uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.workspace_role_for(target_workspace) is null then
    raise exception 'Workspace access required' using errcode = '42501';
  end if;
  perform 1 from public.projects where workspace_id = target_workspace and id = target_project for update;
  if not found then return false; end if;

  if not exists (
    select 1 from public.tasks where id = dependent_task and workspace_id = target_workspace and project_id = target_project
    and (private.workspace_role_for(target_workspace) in ('owner', 'admin') or created_by = auth.uid())
  ) then raise exception 'Permission denied' using errcode = '42501'; end if;

  delete from public.task_dependencies where workspace_id = target_workspace and project_id = target_project
    and source_id = source_task and target_id = dependent_task;
  return found;
end;
$$;

-- Clear edges before the existing project FK unlinks retained tasks.
create function private.clear_project_dependencies()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.task_dependencies where workspace_id = old.workspace_id and project_id = old.id;
  return old;
end;
$$;
create trigger projects_clear_dependencies before delete on public.projects
for each row execute function private.clear_project_dependencies();

revoke execute on function private.clear_project_dependencies(),
  public.add_task_dependency(uuid, uuid, uuid, uuid),
  public.remove_task_dependency(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_task_dependency(uuid, uuid, uuid, uuid),
  public.remove_task_dependency(uuid, uuid, uuid, uuid) to authenticated;

commit;
