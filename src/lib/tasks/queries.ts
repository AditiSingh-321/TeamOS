import "server-only";

import { z } from "zod";
import { createAuthClient } from "@/lib/supabase/server";
import type { Task, TaskComment, TaskCounts, TaskProject } from "@/types/task";
import type { WorkspaceMember } from "@/types/team";

const taskFields = "id, project_id, assignee_id, created_by, title, description, priority, status, due_date, updated_at";
const countSchema = z.object({ total: z.number().int().nonnegative(), done: z.number().int().nonnegative() });

async function collectRows<T>(load: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>) {
  const rows: T[] = [];
  const batch = 250;
  for (;;) {
    const { data, error } = await load(rows.length, rows.length + batch - 1);
    if (error) return { rows: [], error };
    rows.push(...(data ?? []));
    if (!data || data.length < batch) return { rows, error: null };
  }
}

export async function getTaskBoard(workspaceId: string) {
  const supabase = await createAuthClient();
  if (!supabase) return { tasks: [], members: [], projects: [], error: "Task management is unavailable." };

  const [tasks, members, projects] = await Promise.all([
    collectRows((start, end) => supabase.from("tasks").select(taskFields).eq("workspace_id", workspaceId)
      .order("id").range(start, end).overrideTypes<Task[], { merge: false }>()),
    collectRows((start, end) => supabase.from("workspace_members").select("user_id, display_name, role")
      .eq("workspace_id", workspaceId).order("display_name").order("user_id").range(start, end)
      .overrideTypes<WorkspaceMember[], { merge: false }>()),
    collectRows((start, end) => supabase.from("projects").select("id, name").eq("workspace_id", workspaceId)
      .order("name").order("id").range(start, end).overrideTypes<TaskProject[], { merge: false }>()),
  ]);

  const error = tasks.error?.code === "PGRST205" || tasks.error?.code === "42P01"
    ? "Task tables are missing. Apply the Phase 4 Supabase migration."
    : tasks.error || members.error || projects.error ? "Could not load workspace tasks. Refresh to try again." : null;

  return { tasks: tasks.rows, members: members.rows, projects: projects.rows, error };
}

export async function getTaskComments(workspaceId: string, taskId: string) {
  const supabase = await createAuthClient();
  if (!supabase) return { rows: [], error: true };
  return collectRows((start, end) => supabase.from("task_comments").select("id, author_id, body, created_at, mentions:task_comment_mentions!task_comment_mentions_workspace_id_comment_id_fkey(user_id)")
    .eq("workspace_id", workspaceId).eq("task_id", taskId).order("created_at").order("id").range(start, end)
    .overrideTypes<TaskComment[], { merge: false }>());
}

export async function getDashboardTasks(workspaceId: string, userId: string) {
  const supabase = await createAuthClient();
  if (!supabase) return { counts: null, upcoming: [], error: true };
  const [statistics, list] = await Promise.all([
    supabase.rpc("workspace_task_counts", { target_workspace: workspaceId }),
    supabase.from("tasks").select("id, title, priority, due_date, project:projects!tasks_project_workspace_fkey(name)")
      .eq("workspace_id", workspaceId).eq("assignee_id", userId).neq("status", "Done")
      .gte("due_date", new Date().toISOString().slice(0, 10)).order("due_date").order("id").limit(4)
      .overrideTypes<(Pick<Task, "id" | "title" | "priority" | "due_date"> & { project: { name: string } | null })[], { merge: false }>(),
  ]);
  const parsed = countSchema.safeParse(statistics.data);
  const counts: TaskCounts | null = !statistics.error && parsed.success ? parsed.data : null;
  return { counts, upcoming: list.data ?? [], error: !counts || Boolean(list.error) };
}
