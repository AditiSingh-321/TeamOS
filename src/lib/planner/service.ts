import { planningInputSchema, validatePlan, type GeneratedPlan, type PlanningInput } from "./schema";

export interface PlanningProject {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
}

export interface GenerationDependencies {
  authorize: (projectId: string) => Promise<PlanningProject>;
  reserve: (project: PlanningProject, input: PlanningInput, requestId: string) => Promise<boolean>;
  generate: (input: PlanningInput, project: PlanningProject) => Promise<GeneratedPlan>;
  finish: (requestId: string, plan: GeneratedPlan) => Promise<void>;
  fail: (requestId: string, message: string) => Promise<void>;
}

/** Persistence and provider are injected so the entire draft pipeline can be tested without API credits. */
export async function generateDraft(projectId: string, requestId: string, value: unknown, dependencies: GenerationDependencies) {
  const project = await dependencies.authorize(projectId);
  const input = planningInputSchema.parse(value);
  if (!await dependencies.reserve(project, input, requestId)) return requestId;
  try {
    const plan = validatePlan(await dependencies.generate(input, project));
    await dependencies.finish(requestId, plan);
    return requestId;
  } catch (error) {
    // Provider errors are sanitized at the provider boundary.
    await dependencies.fail(requestId, "Generation did not finish. Retry with a new request.");
    throw error;
  }
}
