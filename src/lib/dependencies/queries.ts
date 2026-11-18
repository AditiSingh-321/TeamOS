import "server-only";

import { createAuthClient } from "@/lib/supabase/server";
import type { DependencyEdge } from "./graph";

export async function getDependencies(workspaceId: string, projectId: string) {
  const supabase = await createAuthClient();
  const edges: DependencyEdge[] = [];
  if (!supabase) return { edges, error: "Dependencies are unavailable." };
  for (;;) {
    const { data, error } = await supabase.from("task_dependencies").select("source_id, target_id")
      .eq("workspace_id", workspaceId).eq("project_id", projectId)
      .order("source_id").order("target_id").range(edges.length, edges.length + 249)
      .overrideTypes<DependencyEdge[], { merge: false }>();
    if (error) return {
      edges: [],
      error: error.code === "PGRST205" || error.code === "42P01"
        ? "Apply the Phase 5 Supabase migration to enable dependencies."
        : "Could not load dependencies. Refresh to try again.",
    };
    edges.push(...(data ?? []));
    if (!data || data.length < 250) return { edges, error: null };
  }
}
