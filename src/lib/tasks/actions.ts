"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
import type { WorkspaceActionState } from "@/types/team";
import { commentInputSchema, moveTaskSchema, taskInputSchema, taskMutationSchema } from "./validation";

async function client() {
  await requireAuth();
  const supabase = await createAuthClient(true);
  if (!supabase) redirect("/login");
  return supabase;
}

function refreshTasks() {
  revalidatePath("/my-tasks");
  revalidatePath("/dependencies");
  revalidatePath("/");
}

function mutationError(code: string | undefined) {
  return code === "23503"
    ? "Choose a project and assignee in this workspace. Remove task dependencies before changing its project."
    : "Could not save the task. Check your workspace permissions and try again.";
}

export async function saveTask(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await client();
  const input = taskInputSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: input.error.issues[0].message };
  const taskId = form.get("taskId");
  const { workspace_id, ...fields } = input.data;

  if (taskId === null) {
    const { data, error } = await supabase.from("tasks").insert(input.data).select("id").single();
    if (error || !data) return { error: mutationError(error?.code) };
    refreshTasks();
    redirect(`/my-tasks?task=${data.id}`);
  }

  const target = taskMutationSchema.safeParse({ workspaceId: workspace_id, taskId, updatedAt: form.get("updatedAt") });
  if (!target.success) return { error: "Reopen the task and try again." };
  const { data, error } = await supabase.from("tasks").update(fields)
    .eq("workspace_id", workspace_id).eq("id", target.data.taskId).eq("updated_at", target.data.updatedAt)
    .select("id").maybeSingle();
  if (error) return { error: mutationError(error.code) };
  if (!data) return { error: "The task changed or your access was updated. Refresh and try again." };
  refreshTasks();
  return { message: "Task saved." };
}

export async function deleteTask(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await client();
  const input = taskMutationSchema.safeParse(Object.fromEntries(form));
  if (!input.success || form.get("confirm") !== "on") return { error: "Confirm deletion to continue." };
  const { workspaceId, taskId, updatedAt } = input.data;
  const { data, error } = await supabase.from("tasks").delete()
    .eq("workspace_id", workspaceId).eq("id", taskId).eq("updated_at", updatedAt).select("id").maybeSingle();
  if (error || !data) return { error: "Could not delete this task. It may have changed, or you may not have access." };
  refreshTasks();
  redirect("/my-tasks");
}

export async function moveTask(input: unknown): Promise<WorkspaceActionState> {
  const supabase = await client();
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid task status." };
  const { workspaceId, taskId, updatedAt, status } = parsed.data;
  const { data, error } = await supabase.rpc("move_task", {
    target_workspace: workspaceId, target_task: taskId, expected_updated_at: updatedAt, next_status: status,
  });
  if (error || typeof data !== "string") return { error: "Could not move the task. It may have changed, or you may not have access." };
  refreshTasks();
  return { message: `Task moved to ${status}.` };
}

export async function changeTaskStatus(_state: WorkspaceActionState, form: FormData) {
  return moveTask(Object.fromEntries(form));
}

export async function addTaskComment(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await client();
  const input = commentInputSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: input.error.issues[0].message };
  const { workspaceId, taskId, body } = input.data;
  const { error } = await supabase.from("task_comments").insert({ workspace_id: workspaceId, task_id: taskId, body });
  if (error) return { error: "Could not post the comment. Check whether the task is still available." };
  revalidatePath("/my-tasks");
  revalidatePath("/dependencies");
  return { message: "Comment added." };
}
