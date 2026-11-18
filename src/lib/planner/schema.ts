import { z } from "zod";
import { topologicalSort } from "../dependencies/graph";

export const maxPlanTasks = 30;

export const planningInputSchema = z.strictObject({
  brief: z.string().trim().min(20, "Describe the project in at least 20 characters.").max(8000),
  teamSize: z.number().int().min(1).max(50).nullable(),
  durationWeeks: z.number().int().min(1).max(104).nullable(),
  deadline: z.union([z.iso.date().refine((value) => !value.startsWith("0000")), z.null()]),
  technologyStack: z.string().trim().max(500),
  instructions: z.string().trim().max(2000),
});

// This schema is also sent to the Responses API through zodTextFormat.
export const generatedTaskSchema = z.strictObject({
  tempId: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  priority: z.enum(["low", "medium", "high"]),
  estimatedDays: z.number().min(0.25).max(60),
  suggestedRole: z.string().min(1).max(80),
  acceptanceCriteria: z.array(z.string().min(1).max(250)).min(1).max(8),
  dependsOn: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/)).max(maxPlanTasks - 1),
});

export const generatedPlanSchema = z.strictObject({
  projectSummary: z.string().min(1).max(1500),
  tasks: z.array(generatedTaskSchema).min(1).max(maxPlanTasks),
});

export type PlanningInput = z.infer<typeof planningInputSchema>;
export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;
export type GeneratedTask = z.infer<typeof generatedTaskSchema>;

export function validatePlan(value: unknown): GeneratedPlan {
  const plan = generatedPlanSchema.parse(value);
  const titles = new Set<string>();
  const ids = new Set<string>();
  if (!plan.projectSummary.trim()) throw new Error("Enter a project summary.");
  for (const task of plan.tasks) {
    if (!task.title.trim() || !task.description.trim() || !task.suggestedRole.trim()
      || task.acceptanceCriteria.some((criterion) => !criterion.trim())) throw new Error("Fill in every task field and acceptance criterion.");
    const title = task.title.trim().replace(/\s+/g, " ").toLowerCase();
    if (titles.has(title)) throw new Error("Each task needs a unique title.");
    if (ids.has(task.tempId)) throw new Error("Each task needs a unique temporary ID.");
    if (new Set(task.dependsOn).size !== task.dependsOn.length) throw new Error("A task has duplicate dependencies.");
    ids.add(task.tempId);
    titles.add(title);
  }
  // A fixed project ID confines every draft edge to this plan before real IDs exist.
  topologicalSort(plan.tasks.map((task) => ({ id: task.tempId, project_id: "draft", status: "To Do" })),
    plan.tasks.flatMap((task) => task.dependsOn.map((id) => ({ source_id: id, target_id: task.tempId }))));
  return plan;
}

export function planOrder(plan: GeneratedPlan) {
  return topologicalSort(plan.tasks.map((task) => ({ id: task.tempId, project_id: "draft", status: "To Do" })),
    plan.tasks.flatMap((task) => task.dependsOn.map((id) => ({ source_id: id, target_id: task.tempId }))));
}

export function removeDraftTask(plan: GeneratedPlan, tempId: string) {
  return {
    plan: { ...plan, tasks: plan.tasks.filter((task) => task.tempId !== tempId)
      .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((id) => id !== tempId) })) },
    affected: plan.tasks.filter((task) => task.dependsOn.includes(tempId)).map((task) => task.title),
  };
}

export function newDraftTask(): GeneratedTask {
  return {
    tempId: crypto.randomUUID(), title: "", description: "", priority: "medium",
    estimatedDays: 1, suggestedRole: "", acceptanceCriteria: [""], dependsOn: [],
  };
}
