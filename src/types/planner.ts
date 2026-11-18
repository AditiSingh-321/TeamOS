import type { GeneratedPlan, PlanningInput } from "@/lib/planner/schema";

export type PlanStatus = "generating" | "draft" | "approved" | "cancelled" | "failed";

export interface SavedPlan {
  id: string;
  brief: string;
  preferences: Omit<PlanningInput, "brief">;
  generated_plan: GeneratedPlan | null;
  status: PlanStatus;
  error_message: string | null;
  revision: number;
  created_at: string;
  approved_at: string | null;
}
