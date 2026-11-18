import { z } from "zod";
import { downstreamTasks, type DependencyEdge } from "../dependencies/graph";
export const blockerTypes = ["technical_issue", "missing_information", "external_dependency", "resource_constraint", "approval_pending", "schedule_delay", "other"] as const;
export const classificationSchema = z.strictObject({
  state: z.enum(["confirmed", "possible", "normal", "resolved", "completed"]),
  blockerType: z.enum(blockerTypes), reason: z.string().max(600), evidence: z.string().max(2000),
  reportedDelayDays: z.number().int().min(1).max(365).nullable(), confidence: z.number().min(0).max(1),
  suggestedActions: z.array(z.string().min(1).max(300)).max(4),
});
export type Classification = z.infer<typeof classificationSchema>;
export interface RiskTask { id: string; project_id: string; title: string; status: string; priority: string; due_date: string | null; is_blocked: boolean }
export interface RiskContext { tasks: RiskTask[]; edges: DependencyEdge[]; project: { deadline: string | null }; risks: { id: string; source_task_id: string | null; confirmation: string }[] }
export function shouldClassify(text: string) {
  return /\b(block(?:ed|er)?|stuck|cannot|can't|waiting|missing|delay(?:ed)?|approval|credentials)\b/i.test(text);
}
export function resolvedUpdate(text: string) { return /\b(resolved|unblocked|no longer blocked|completed successfully)\b/i.test(text) && !/\b(still|but|however|another)\b/i.test(text); }
export function verifiedClassification(value: unknown, text: string): Classification {
  const result = classificationSchema.parse(value);
  if (["confirmed", "possible"].includes(result.state) && (!result.evidence.trim() || !text.includes(result.evidence))) throw new Error("Blocker evidence does not match its source.");
  // A delay is a report, never an inferred change to the project delivery date.
  const days = text.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:working\s+)?days?\b/i)?.[1];
  const words = ["zero","one","two","three","four","five","six","seven","eight","nine","ten"];
  return { ...result, reportedDelayDays: days ? (/^\d+$/.test(days) ? (Number(days)<=365 ? Number(days) : 0) : words.indexOf(days.toLowerCase())) || null : null };
}
export function riskImpact(task: RiskTask, context: RiskContext, confirmed: boolean, today: string) {
  const projectTasks = context.tasks.filter((row) => row.project_id === task.project_id);
  const ids = new Set(projectTasks.map((row) => row.id));
  // Existing graph code rejects cycles and invalid cross-project edges rather than guessing.
  const edges = context.edges.filter((edge) => ids.has(edge.source_id) || ids.has(edge.target_id));
  const affected = downstreamTasks(projectTasks, edges, task.id).filter((id) => projectTasks.find((row) => row.id === id)?.status !== "Done");
  const explanations: string[] = []; let score = 0;
  const add = (points: number, reason: string) => { score += points; explanations.push(`+${points}: ${reason}`); };
  add(confirmed ? 25 : 10, confirmed ? "Confirmed blocker or recorded schedule issue" : "Possible blocker requiring review");
  if (task.priority === "High") add(20,"High-priority source task"); else if (task.priority === "Medium") add(10,"Medium-priority source task");
  if (affected.length) add(Math.min(25,affected.length * 5),`${affected.length} incomplete downstream tasks`);
  const due = task.due_date;
  if (due && due < today) add(20,"Source task is overdue");
  else if (due && Date.parse(due) - Date.parse(today) <= 7 * 86400000) add(10,"Source task is due within seven days");
  const delivery = context.project.deadline;
  if (delivery && (delivery < today || affected.some((id) => { const date = projectTasks.find((row) => row.id===id)?.due_date; return date && date > delivery; }))) add(10,"Project deadline is past or a downstream due date exceeds it");
  explanations.push("Duration and slack are unavailable; no project delay date is inferred. Project delivery is the only recorded milestone.");
  return { affected_task_ids: affected, score, severity: score >= 80 ? "Critical" : score >= 55 ? "High" : score >= 30 ? "Medium" : "Low", explanations };
}
