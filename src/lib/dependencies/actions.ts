"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
import type { WorkspaceActionState } from "@/types/team";
import { dependencyInputSchema } from "./validation";

export async function saveDependency(input: unknown, remove = false): Promise<WorkspaceActionState> {
  await requireAuth();
  const parsed = dependencyInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose two different tasks in the selected project." };
  const supabase = await createAuthClient(true);
  if (!supabase) return { error: "Sign in to manage dependencies." };
  const { workspaceId, projectId, sourceId, targetId } = parsed.data;
  const { data, error } = await supabase.rpc(remove ? "remove_task_dependency" : "add_task_dependency", {
    target_workspace: workspaceId, target_project: projectId, source_task: sourceId, dependent_task: targetId,
  });
  if (error?.code === "23514") return { error: "This dependency would create a cycle or refer to the same task." };
  if (error?.code === "23503") return { error: "Both tasks must belong to this project. Refresh and try again." };
  if (error?.code === "42501") return { error: "Only workspace managers or the dependent task creator can change its dependencies." };
  if (error || (remove && data !== true)) return { error: "Could not change the dependency. Refresh and try again." };

  revalidatePath("/dependencies");
  return { message: remove ? "Dependency removed." : "Dependency created." };
}
