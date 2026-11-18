"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
import { plannedTaskInput } from "@/lib/tasks/planned-task";
import { authorizePlanningProject, PlannerAccessError } from "./access";
import { generatePlan, plannerConfiguration, PlannerError } from "./sarvam";
import { validatePlan } from "./schema";
import { generateDraft } from "./service";

export interface PlannerResult {
  error?: string;
  message?: string;
  planId?: string;
  revision?: number;
  status?: "draft" | "approved" | "cancelled";
}

const requestSchema = z.object({ projectId: z.uuid(), requestId: z.uuid() });
const reviewSchema = z.object({
  projectId: z.uuid(), planId: z.uuid(), revision: z.number().int().min(0),
  operation: z.enum(["save", "approve", "cancel"]),
});

async function context(projectId: string) {
  const profile = await requireAuth();
  const supabase = await createAuthClient(true);
  if (!supabase) throw new PlannerAccessError("Sign in to use the planner.");
  const project = await authorizePlanningProject(supabase, profile.id, projectId);
  return { supabase, project };
}

function databaseError(error: { code?: string } | null) {
  if (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42P01") return "Apply the Phase 6 database migration first.";
  if (error?.code === "40001") return "This plan changed in another request. Reload it before saving or approving.";
  if (error?.code === "42501") return "You no longer have permission to change this project plan.";
  if (error?.code === "P0001") return "A generation is already running, or your generation limit was reached. Wait a few minutes and retry.";
  if (error?.code === "23514") return "The plan failed database validation. Check task fields and dependencies.";
  return "Could not save the plan. Your existing project tasks are safe. Retry or refresh.";
}

function actionError(error: unknown): PlannerResult {
  if (error instanceof PlannerError || error instanceof PlannerAccessError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Check the plan fields." };
  return { error: "The planner request did not finish. Reload your saved plans before retrying." };
}

export async function generateAiDraft(projectId: string, requestId: string, input: unknown): Promise<PlannerResult> {
  const parsed = requestSchema.safeParse({ projectId, requestId });
  if (!parsed.success) return { error: "Choose a valid project and retry." };
  // Keep redirect errors outside the error-mapping boundary.
  await requireAuth();
  try {
    const { supabase, project } = await context(parsed.data.projectId);
    if (!plannerConfiguration().apiKey) return { error: "Set SARVAM_API_KEY on the server to enable AI generation." };
    const planId = await generateDraft(projectId, requestId, input, {
      authorize: async () => project,
      reserve: async (target, data, id) => {
        const { brief, ...preferences } = data;
        const { data: started, error } = await supabase.rpc("reserve_ai_plan", {
          target_project: target.id, request_id: id, project_brief: brief, planning_preferences: preferences,
        });
        if (error) throw new PlannerError(databaseError(error));
        return started === true;
      },
      generate: generatePlan,
      finish: async (id, plan) => {
        const { data: finished, error } = await supabase.rpc("finish_ai_plan", { target_plan: id, plan });
        if (error) throw new PlannerError(databaseError(error));
        if (!finished) throw new PlannerError("The generation was cancelled. Check your saved plans.");
      },
      fail: async (id) => { await supabase.rpc("fail_ai_plan", { target_plan: id }); },
    });
    revalidatePath(`/projects/${project.id}/plan`);
    return { planId, message: "Saved the request. Review the generated draft before approval." };
  } catch (error) {
    revalidatePath(`/projects/${projectId}/plan`);
    return actionError(error);
  }
}

export async function reviewAiDraft(input: unknown, editedPlan: unknown): Promise<PlannerResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Reopen the saved draft and try again." };
  await requireAuth();
  try {
    const { projectId, planId, revision, operation } = parsed.data;
    const { supabase, project } = await context(projectId);
    const { data: draft, error: lookupError } = await supabase.from("ai_project_plans").select("id")
      .eq("id", planId).eq("project_id", projectId).maybeSingle();
    if (lookupError) return { error: databaseError(lookupError) };
    if (!draft) return { error: "This draft is unavailable in the project." };
    let plan = null;
    if (operation !== "cancel") {
      try { plan = validatePlan(editedPlan); }
      catch (error) {
        if (error instanceof z.ZodError) return actionError(error);
        return { error: error instanceof Error ? error.message : "Check the draft fields." };
      }
    }
    // Reuse the task service's validation and representation before the atomic import.
    if (plan) for (const task of plan.tasks) plannedTaskInput(task, project.workspace_id, project.id);

    if (operation === "approve") {
      const { data, error } = await supabase.rpc("approve_ai_plan", { target_plan: planId, expected_revision: revision, plan });
      if (error || !data) return { error: databaseError(error) };
      revalidatePath("/", "layout");
      return { status: "approved", message: "Plan approved. Tasks and dependencies are now in your project." };
    }
    const { data, error } = await supabase.rpc("edit_ai_plan", {
      target_plan: planId, expected_revision: revision, plan, cancel: operation === "cancel",
    });
    if (error || typeof data !== "number") return { error: databaseError(error) };
    revalidatePath(`/projects/${project.id}/plan`);
    return { revision: data, status: operation === "cancel" ? "cancelled" : "draft",
      message: operation === "cancel" ? "Plan cancelled." : "Draft saved." };
  } catch (error) {
    return actionError(error);
  }
}
