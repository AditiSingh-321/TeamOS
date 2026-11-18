begin;

create type public.task_status as enum ('To Do', 'In Progress', 'Review', 'Done');
create type public.task_priority as enum ('Low', 'Medium', 'High');

-- Composite keys prevent linking tasks or assignees across workspaces.
alter table public.projects add constraint projects_workspace_id_key unique (workspace_id, id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid,
  assignee_id uuid,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  priority public.task_priority not null default 'Medium',
  status public.task_status not null default 'To Do',
  due_date date check (due_date between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (workspace_id, id),
  constraint tasks_project_workspace_fkey foreign key (workspace_id, project_id)
    references public.projects(workspace_id, id) on delete set null (project_id),
  constraint tasks_assignee_workspace_fkey foreign key (workspace_id, assignee_id)
    references public.workspace_members(workspace_id, user_id) on delete set null (assignee_id)
);

create index tasks_by_workspace_status on public.tasks(workspace_id, status);
create index tasks_by_assignee_due on public.tasks(workspace_id, assignee_id, due_date, id);
create index tasks_by_project on public.tasks(workspace_id, project_id);
create index tasks_by_creator on public.tasks(created_by);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, task_id) references public.tasks(workspace_id, id) on delete cascade
);

create index task_comments_by_task on public.task_comments(workspace_id, task_id, created_at, id);
create index task_comments_by_author on public.task_comments(author_id);

create function private.touch_task()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger tasks_touch before update on public.tasks
for each row execute function private.touch_task();

alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;

revoke all on public.tasks, public.task_comments from public, anon, authenticated;
grant select, delete on public.tasks to authenticated;
grant insert (workspace_id, project_id, assignee_id, title, description, priority, status, due_date),
  update (project_id, assignee_id, title, description, priority, status, due_date) on public.tasks to authenticated;
grant select on public.task_comments to authenticated;
grant insert (workspace_id, task_id, body) on public.task_comments to authenticated;

create policy tasks_read on public.tasks for select to authenticated
using (private.workspace_role_for(workspace_id) is not null);

create policy tasks_create on public.tasks for insert to authenticated with check (
  private.workspace_role_for(workspace_id) is not null and created_by = (select auth.uid())
);

create policy tasks_edit on public.tasks for update to authenticated
using (
  private.workspace_role_for(workspace_id) is not null
  and (private.workspace_role_for(workspace_id) in ('owner', 'admin') or created_by = (select auth.uid()))
)
with check (
  private.workspace_role_for(workspace_id) is not null
  and (private.workspace_role_for(workspace_id) in ('owner', 'admin') or created_by = (select auth.uid()))
);

create policy tasks_delete on public.tasks for delete to authenticated using (
  private.workspace_role_for(workspace_id) is not null
  and (private.workspace_role_for(workspace_id) in ('owner', 'admin') or created_by = (select auth.uid()))
);

create policy comments_read on public.task_comments for select to authenticated
using (private.workspace_role_for(workspace_id) is not null);

create policy comments_create on public.task_comments for insert to authenticated with check (
  private.workspace_role_for(workspace_id) is not null and author_id = (select auth.uid())
);

-- Assignees who cannot edit the whole task may still change its status.
create function public.move_task(
  target_workspace uuid, target_task uuid, expected_updated_at timestamptz, next_status public.task_status
)
returns timestamptz language sql security definer set search_path = '' as $$
  update public.tasks t set status = next_status
  where t.workspace_id = target_workspace and t.id = target_task
    and t.updated_at = expected_updated_at and t.status <> next_status
    and private.workspace_role_for(t.workspace_id) is not null
    and (
      private.workspace_role_for(t.workspace_id) in ('owner', 'admin')
      or t.created_by = (select auth.uid())
      or t.assignee_id = (select auth.uid())
    )
  returning t.updated_at;
$$;

create function public.workspace_task_counts(target_workspace uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('total', count(*), 'done', count(*) filter (where status = 'Done'))
  from public.tasks where workspace_id = target_workspace;
$$;

revoke execute on function private.touch_task(),
  public.move_task(uuid, uuid, timestamptz, public.task_status),
  public.workspace_task_counts(uuid) from public, anon, authenticated;
grant execute on function public.move_task(uuid, uuid, timestamptz, public.task_status),
  public.workspace_task_counts(uuid) to authenticated;

commit;
