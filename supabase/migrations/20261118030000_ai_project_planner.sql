begin;

create table public.ai_project_plans (
  id uuid primary key,
  workspace_id uuid not null,
  project_id uuid not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  brief text not null check (char_length(btrim(brief)) between 20 and 8000),
  preferences jsonb not null check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 5000),
  generated_plan jsonb,
  status text not null default 'generating' check (status in ('generating', 'draft', 'approved', 'cancelled', 'failed')),
  error_message text check (char_length(error_message) <= 500),
  task_ids jsonb not null default '{}',
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  check (status not in ('draft', 'approved') or generated_plan is not null),
  check ((status = 'approved') = (approved_at is not null))
);

create index ai_project_plans_by_project on public.ai_project_plans(workspace_id, project_id, created_at desc, id);
create index ai_project_plans_by_creator on public.ai_project_plans(created_by, created_at desc);
alter table public.ai_project_plans enable row level security;
revoke all on public.ai_project_plans from public, anon, authenticated;
grant select on public.ai_project_plans to authenticated;
create policy ai_project_plans_read on public.ai_project_plans for select to authenticated
using (private.workspace_role_for(workspace_id) in ('owner', 'admin'));

create function private.validate_ai_plan(plan jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  task jsonb;
  criterion jsonb;
  link jsonb;
begin
  if plan is null or jsonb_typeof(plan) <> 'object'
     or jsonb_typeof(plan -> 'projectSummary') is distinct from 'string'
     or char_length(btrim(plan ->> 'projectSummary')) not between 1 and 1500
     or jsonb_typeof(plan -> 'tasks') is distinct from 'array' then
    raise exception 'Invalid plan structure' using errcode = '23514';
  end if;
  if jsonb_array_length(plan -> 'tasks') not between 1 and 30 then
    raise exception 'Plans need between 1 and 30 tasks' using errcode = '23514';
  end if;
  for task in select value from jsonb_array_elements(plan -> 'tasks') loop
    if jsonb_typeof(task) <> 'object'
       or jsonb_typeof(task -> 'tempId') is distinct from 'string'
       or (task ->> 'tempId') !~ '^[a-zA-Z0-9_-]{1,40}$'
       or jsonb_typeof(task -> 'title') is distinct from 'string'
       or char_length(btrim(task ->> 'title')) not between 1 and 120
       or char_length(task ->> 'title') > 120
       or jsonb_typeof(task -> 'description') is distinct from 'string'
       or char_length(btrim(task ->> 'description')) not between 1 and 2000
       or char_length(task ->> 'description') > 2000
       or jsonb_typeof(task -> 'priority') is distinct from 'string'
       or (task ->> 'priority') not in ('low', 'medium', 'high')
       or jsonb_typeof(task -> 'estimatedDays') is distinct from 'number'
       or jsonb_typeof(task -> 'suggestedRole') is distinct from 'string'
       or char_length(btrim(task ->> 'suggestedRole')) not between 1 and 80
       or char_length(task ->> 'suggestedRole') > 80
       or jsonb_typeof(task -> 'acceptanceCriteria') is distinct from 'array'
       or jsonb_typeof(task -> 'dependsOn') is distinct from 'array' then
      raise exception 'Invalid task fields' using errcode = '23514';
    end if;
    if (task ->> 'estimatedDays')::numeric not between 0.25 and 60
       or jsonb_array_length(task -> 'acceptanceCriteria') not between 1 and 8
       or jsonb_array_length(task -> 'dependsOn') > 29 then
      raise exception 'Invalid effort, criteria, or dependency count' using errcode = '23514';
    end if;
    for criterion in select value from jsonb_array_elements(task -> 'acceptanceCriteria') loop
      if jsonb_typeof(criterion) <> 'string' or char_length(btrim(criterion #>> '{}')) not between 1 and 250
         or char_length(criterion #>> '{}') > 250 then
        raise exception 'Invalid acceptance criterion' using errcode = '23514';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(task -> 'dependsOn')) <>
       (select count(distinct value) from jsonb_array_elements(task -> 'dependsOn')) then
      raise exception 'Duplicate dependencies' using errcode = '23514';
    end if;
    for link in select value from jsonb_array_elements(task -> 'dependsOn') loop
      if jsonb_typeof(link) <> 'string' or link #>> '{}' = task ->> 'tempId'
         or not exists (select 1 from jsonb_array_elements(plan -> 'tasks') t where t ->> 'tempId' = link #>> '{}') then
        raise exception 'Invalid dependency reference' using errcode = '23514';
      end if;
    end loop;
  end loop;

  if exists (select 1 from jsonb_array_elements(plan -> 'tasks') t group by t ->> 'tempId' having count(*) > 1)
     or exists (select 1 from jsonb_array_elements(plan -> 'tasks') t
       group by lower(btrim(regexp_replace(t ->> 'title', '[[:space:]]+', ' ', 'g'))) having count(*) > 1) then
    raise exception 'Duplicate task IDs or titles' using errcode = '23514';
  end if;

  if exists (
    with recursive links(source, target) as (
      select prerequisite, t ->> 'tempId' from jsonb_array_elements(plan -> 'tasks') t,
        lateral jsonb_array_elements_text(t -> 'dependsOn') prerequisite
    ), reach(source, target) as (
      select source, target from links
      union
      select r.source, l.target from reach r join links l on r.target = l.source
    ) select 1 from reach where source = target
  ) then raise exception 'Dependency cycle' using errcode = '23514'; end if;
end;
$$;

create function public.reserve_ai_plan(target_project uuid, request_id uuid, project_brief text, planning_preferences jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  prior public.ai_project_plans;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select workspace_id into workspace from public.projects where id = target_project;
  if workspace is null or private.workspace_role_for(workspace) not in ('owner', 'admin')
     or private.workspace_role_for(workspace) is null then
    raise exception 'Project manager access required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 6));
  select * into prior from public.ai_project_plans where id = request_id;
  if found then
    if prior.created_by is distinct from auth.uid() or prior.project_id <> target_project then
      raise exception 'Request is unavailable' using errcode = '42501';
    end if;
    return false;
  end if;

  if exists (select 1 from public.ai_project_plans where created_by = auth.uid()
      and status = 'generating' and created_at > clock_timestamp() - interval '2 minutes')
    or (select count(*) from public.ai_project_plans where created_by = auth.uid()
      and created_at > clock_timestamp() - interval '10 minutes') >= 3 then
    raise exception 'Generation limit reached. Wait a few minutes before retrying.' using errcode = 'P0001';
  end if;
  insert into public.ai_project_plans (id, workspace_id, project_id, brief, preferences)
  values (request_id, workspace, target_project, btrim(project_brief), planning_preferences);
  return true;
end;
$$;

create function public.finish_ai_plan(target_plan uuid, plan jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  draft public.ai_project_plans;
begin
  select * into draft from public.ai_project_plans where id = target_plan for update;
  if not found or draft.created_by is distinct from auth.uid()
    or coalesce(private.workspace_role_for(draft.workspace_id) in ('owner', 'admin'), false) = false then
    raise exception 'Project manager access required' using errcode = '42501';
  end if;
  if draft.status <> 'generating' then return false; end if;
  perform private.validate_ai_plan(plan);
  update public.ai_project_plans set generated_plan = plan, status = 'draft',
    revision = revision + 1, updated_at = clock_timestamp() where id = target_plan;
  return true;
end;
$$;

create function public.fail_ai_plan(target_plan uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_project_plans set status = 'failed', error_message = 'Generation did not finish. Try again.',
    revision = revision + 1, updated_at = clock_timestamp()
  where id = target_plan and created_by = auth.uid() and status = 'generating'
    and private.workspace_role_for(workspace_id) in ('owner', 'admin');
end;
$$;

create function public.edit_ai_plan(target_plan uuid, expected_revision integer, plan jsonb, cancel boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  draft public.ai_project_plans;
  next_revision integer;
begin
  select * into draft from public.ai_project_plans where id = target_plan for update;
  if not found or coalesce(private.workspace_role_for(draft.workspace_id) in ('owner', 'admin'), false) = false then
    raise exception 'Project manager access required' using errcode = '42501';
  end if;
  if draft.revision <> expected_revision or draft.status in ('approved', 'cancelled') then
    raise exception 'Draft changed. Reload before editing.' using errcode = '40001';
  end if;
  if not cancel and draft.status <> 'draft' then
    raise exception 'This plan is not ready to edit' using errcode = '23514';
  end if;
  if not cancel then perform private.validate_ai_plan(plan); end if;
  update public.ai_project_plans set generated_plan = case when cancel then generated_plan else plan end,
    status = case when cancel then 'cancelled' else 'draft' end,
    revision = revision + 1, updated_at = clock_timestamp()
  where id = target_plan returning revision into next_revision;
  return next_revision;
end;
$$;

create function public.approve_ai_plan(target_plan uuid, expected_revision integer, plan jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  draft public.ai_project_plans;
  task jsonb;
  dependency text;
  real_id uuid;
  mapping jsonb := '{}';
  task_description text;
begin
  select * into draft from public.ai_project_plans where id = target_plan for update;
  if not found or coalesce(private.workspace_role_for(draft.workspace_id) in ('owner', 'admin'), false) = false then
    raise exception 'Project manager access required' using errcode = '42501';
  end if;
  -- Retrying an approved plan returns the original mapping without inserting anything.
  if draft.status = 'approved' then return draft.task_ids; end if;
  if draft.status <> 'draft' or draft.revision <> expected_revision then
    raise exception 'Draft changed. Reload before approving.' using errcode = '40001';
  end if;
  perform 1 from public.projects where id = draft.project_id and workspace_id = draft.workspace_id for update;
  if not found then raise exception 'Project is unavailable' using errcode = '23503'; end if;
  perform private.validate_ai_plan(plan);

  for task in select value from jsonb_array_elements(plan -> 'tasks') loop
    task_description := (task ->> 'description') || E'\n\nSuggested role: ' || (task ->> 'suggestedRole')
      || E'\nEstimated effort: ' || (task ->> 'estimatedDays') || E' person-days (estimate)'
      || E'\n\nAcceptance criteria:\n'
      || (select string_agg('- ' || value, E'\n' order by ord) from jsonb_array_elements_text(task -> 'acceptanceCriteria') with ordinality c(value, ord));
    insert into public.tasks (workspace_id, project_id, created_by, title, description, priority, status)
    values (draft.workspace_id, draft.project_id, auth.uid(), btrim(task ->> 'title'), task_description,
      initcap(task ->> 'priority')::public.task_priority, 'To Do')
    returning id into real_id;
    mapping := mapping || jsonb_build_object(task ->> 'tempId', real_id);
  end loop;

  for task in select value from jsonb_array_elements(plan -> 'tasks') loop
    for dependency in select value from jsonb_array_elements_text(task -> 'dependsOn') loop
      perform public.add_task_dependency(draft.workspace_id, draft.project_id,
        (mapping ->> dependency)::uuid, (mapping ->> (task ->> 'tempId'))::uuid);
    end loop;
  end loop;
  update public.ai_project_plans set generated_plan = plan, status = 'approved', task_ids = mapping,
    revision = revision + 1, approved_at = clock_timestamp(), updated_at = clock_timestamp() where id = target_plan;
  return mapping;
end;
$$;

-- Task-backed projects derive progress from completed tasks; empty projects retain manual progress.
create function private.project_task_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  total integer;
  done integer;
begin
  select count(*), count(*) filter (where status = 'Done') into total, done
  from public.tasks where workspace_id = new.workspace_id and project_id = new.id;
  if total > 0 then new.progress := round(100.0 * done / total); end if;
  return new;
end;
$$;
create trigger projects_task_progress before update on public.projects
for each row execute function private.project_task_progress();

create function private.refresh_task_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_project uuid;
  new_project uuid;
  project uuid;
begin
  if tg_op <> 'INSERT' then old_project := old.project_id; end if;
  if tg_op <> 'DELETE' then new_project := new.project_id; end if;
  for project in select distinct p from unnest(array[old_project, new_project]) p where p is not null order by p loop
    perform 1 from public.projects where id = project for update;
    update public.projects set progress = coalesce(
      (select round(100.0 * count(*) filter (where status = 'Done') / nullif(count(*), 0))
        from public.tasks where project_id = project), 0
    ) where id = project;
  end loop;
  return null;
end;
$$;
create trigger tasks_project_progress after insert or delete or update of status, project_id on public.tasks
for each row execute function private.refresh_task_progress();

update public.projects p set progress = p.progress where exists (select 1 from public.tasks t where t.project_id = p.id);

revoke execute on function private.validate_ai_plan(jsonb), private.project_task_progress(), private.refresh_task_progress(),
  public.reserve_ai_plan(uuid, uuid, text, jsonb), public.finish_ai_plan(uuid, jsonb), public.fail_ai_plan(uuid),
  public.edit_ai_plan(uuid, integer, jsonb, boolean), public.approve_ai_plan(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_ai_plan(uuid, uuid, text, jsonb), public.finish_ai_plan(uuid, jsonb),
  public.fail_ai_plan(uuid), public.edit_ai_plan(uuid, integer, jsonb, boolean), public.approve_ai_plan(uuid, integer, jsonb)
  to authenticated;

commit;
