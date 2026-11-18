import "server-only";

import { createAuthClient } from "@/lib/supabase/server";
import type { SavedPlan } from "@/types/planner";

export async function getSavedPlans(projectId: string) {
  const supabase = await createAuthClient();
  if (!supabase) return { plans: [], error: "Planner data is unavailable." };
  const plans: SavedPlan[] = [];
  for (;;) {
    const { data, error } = await supabase.from("ai_project_plans")
      .select("id, brief, preferences, generated_plan, status, error_message, revision, created_at, approved_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }).order("id")
      .range(plans.length, plans.length + 99).overrideTypes<SavedPlan[], { merge: false }>();
    if (error) return {
      plans: [],
      error: error.code === "PGRST205" || error.code === "42P01"
        ? "Apply the Phase 6 Supabase migration to enable saved plans."
        : "Could not load saved plans. Refresh to try again.",
    };
    plans.push(...(data ?? []));
    if (!data || data.length < 100) return { plans, error: null };
  }
}
