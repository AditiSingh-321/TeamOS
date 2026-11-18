import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningProject } from "./service";

export class PlannerAccessError extends Error {}

export async function authorizePlanningProject(supabase: SupabaseClient, userId: string, projectId: string): Promise<PlanningProject> {
  const { data: project, error } = await supabase.from("projects").select("id, workspace_id, name, description")
    .eq("id", projectId).maybeSingle().overrideTypes<PlanningProject, { merge: false }>();
  if (error || !project) throw new PlannerAccessError("This project is unavailable.");
  const { data: member, error: membershipError } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", project.workspace_id).eq("user_id", userId).maybeSingle();
  if (membershipError || !member || !["owner", "admin"].includes(member.role)) {
    throw new PlannerAccessError("Only workspace owners and admins can use the project planner.");
  }
  return project;
}
