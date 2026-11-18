import type { GeneratedTask } from "../planner/schema";
import { taskInputSchema } from "./validation";

export function plannedTaskInput(task: GeneratedTask, workspaceId: string, projectId: string) {
  return taskInputSchema.parse({
    workspace_id: workspaceId,
    project_id: projectId,
    assignee_id: "",
    title: task.title.trim(),
    description: [
      task.description,
      "",
      `Suggested role: ${task.suggestedRole}`,
      `Estimated effort: ${task.estimatedDays} person-days (estimate)`,
      "",
      "Acceptance criteria:",
      ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    ].join("\n"),
    priority: { low: "Low", medium: "Medium", high: "High" }[task.priority],
    status: "To Do",
    due_date: "",
  });
}
