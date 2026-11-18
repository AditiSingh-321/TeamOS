import { riskImpact, resolvedUpdate, shouldClassify, verifiedClassification, type Classification, type RiskContext } from "./risk";
export interface RiskEvent { id: string; source_task_id: string | null; kind: string; evidence: string }
export async function analyzeRiskEvent(event: RiskEvent, context: RiskContext, classify: (text: string) => Promise<unknown>, today: string) {
  const task = context.tasks.find((row) => row.id === event.source_task_id);
  let result: Classification | null = null;
  const deterministic = (state: Classification["state"], reason: string, type: Classification["blockerType"] = "other"): Classification => ({state,reason,blockerType:type,evidence:event.evidence,confidence:1,reportedDelayDays:null,suggestedActions:["Review the source task and coordinate with its owner.","Review incomplete downstream work before changing dates."]});
  if (task?.status === "Done") result = deterministic("completed","Task is complete");
  else if (task?.is_blocked) result = deterministic("confirmed","Task is explicitly marked blocked");
  else if (task && event.kind === "overdue" && task.due_date && task.due_date < today) result = deterministic("confirmed","Task is overdue","schedule_delay");
  else if (task && event.kind === "deadline_extended") result = deterministic("possible","A task deadline was extended; downstream exposure needs review.","schedule_delay");
  else if (task && ["comment","reanalysis","meeting"].includes(event.kind) && shouldClassify(event.evidence)) {
    result = resolvedUpdate(event.evidence) ? deterministic("resolved","Source reports that the issue is resolved") : verifiedClassification(await classify(event.evidence),event.evidence);
  }
  const sources = new Set(context.risks.map((risk)=>risk.source_task_id));
  if (task && result && ["confirmed","possible"].includes(result.state)) sources.add(task.id);
  const impacts = context.tasks.filter((row)=>sources.has(row.id)).map((row)=>({ task_id:row.id,...riskImpact(row,context,Boolean(row.is_blocked || (row.id===task?.id && result?.state==="confirmed") || context.risks.some((risk)=>risk.source_task_id===row.id && risk.confirmation==="confirmed")),today) }));
  return { result, impacts };
}
