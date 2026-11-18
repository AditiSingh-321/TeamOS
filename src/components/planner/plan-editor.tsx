"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/workspaces/styles";
import { reviewAiDraft } from "@/lib/planner/actions";
import { maxPlanTasks, newDraftTask, planOrder, removeDraftTask, validatePlan, type GeneratedPlan, type GeneratedTask } from "@/lib/planner/schema";
import type { SavedPlan } from "@/types/planner";

function validationMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check the draft fields.";
  return error instanceof Error ? error.message : "Check the draft fields.";
}

export function PlanPoller({ plans }: { plans: SavedPlan[] }) {
  const router = useRouter();
  useEffect(() => {
    const recent = plans.some((plan) => plan.status === "generating" && Date.now() - new Date(plan.created_at).getTime() < 120000);
    if (!recent) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [plans, router]);
  return null;
}

export function PlanLifecycle({ projectId, saved }: { projectId: string; saved: SavedPlan }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <Card className="space-y-3 p-5">
      <Badge>{saved.status}</Badge>
      <p className="text-sm text-muted-foreground">
        {saved.status === "generating" ? "Generation is pending. Refresh to check progress, or cancel and generate a new draft if it has been interrupted."
          : saved.error_message ?? "This plan has been cancelled."}
      </p>
      {saved.status !== "cancelled" && <button type="button" disabled={pending} onClick={() => {
        startTransition(async () => {
          try {
            const result = await reviewAiDraft({ projectId, planId: saved.id, revision: saved.revision, operation: "cancel" }, null);
            if (result.error) setError(result.error);
            router.refresh();
          } catch { setError("Could not cancel the request. Refresh and try again."); }
        });
      }} className="rounded text-sm font-semibold text-destructive hover:underline disabled:opacity-60">{pending ? "Cancelling…" : "Cancel plan"}</button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

export function PlanEditor({ projectId, saved }: { projectId: string; saved: SavedPlan }) {
  const router = useRouter();
  const [plan, setPlan] = useState<GeneratedPlan>(saved.generated_plan!);
  const [revision, setRevision] = useState(saved.revision);
  const [status, setStatus] = useState(saved.status);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const editable = status === "draft";
  let invalid = "";
  let order: string[] = [];
  try { order = planOrder(validatePlan(plan)); }
  catch (error) { invalid = validationMessage(error); }

  function changePlan(next: GeneratedPlan) {
    setPlan(next);
    setDirty(true);
    setReviewed(false);
    setNotice({});
  }

  function updateTask(index: number, fields: Partial<GeneratedTask>) {
    changePlan({ ...plan, tasks: plan.tasks.map((task, position) => position === index ? { ...task, ...fields } : task) });
  }

  function submit(operation: "save" | "approve" | "cancel") {
    if (pending || (operation === "approve" && !reviewed)) return;
    setNotice({});
    startTransition(async () => {
      try {
        const result = await reviewAiDraft({ projectId, planId: saved.id, revision, operation }, plan);
        setNotice(result);
        if (!result.error) {
          if (result.revision !== undefined) setRevision(result.revision);
          if (result.status) setStatus(result.status);
          setDirty(false);
          router.refresh();
        }
      } catch {
        setNotice({ error: "The request was interrupted. Reload the saved plan before retrying approval." });
      }
    });
  }

  return (
    <section className="space-y-4" aria-label="Plan preview">
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Plan preview</h2>
          <Badge variant={status === "approved" ? "green" : "violet"}>{status === "draft" ? "Draft suggestions" : status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Review the scope and effort estimates with your team. Effort is an estimate in person-days, and suggested roles describe expertise.</p>
        <label className="grid gap-1.5 text-sm font-medium">Project summary
          <textarea rows={3} maxLength={1500} disabled={!editable || pending} value={plan.projectSummary}
            onChange={(event) => changePlan({ ...plan, projectSummary: event.target.value })} className={fieldClass} />
        </label>
        {dirty && <p className="text-xs text-amber-800">You have unsaved edits.</p>}
        {status === "approved" && <p role="status" className="text-sm text-emerald-800">Approved tasks are available in <Link href="/my-tasks" className="font-semibold underline">My Tasks</Link> and the <Link href={`/dependencies?project=${projectId}`} className="font-semibold underline">dependency graph</Link>.</p>}
      </Card>

      {plan.tasks.map((task, index) => (
        <Card key={task.tempId} className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Task {index + 1}</h3>
            {editable && <button type="button" disabled={pending} onClick={() => {
              const result = removeDraftTask(plan, task.tempId);
              changePlan(result.plan);
              setNotice({ message: result.affected.length ? `Removed task and updated dependencies for ${result.affected.join(", ")}.` : "Removed task." });
            }} className="rounded text-sm font-medium text-destructive hover:underline disabled:opacity-60">Remove task {index + 1}</button>}
          </div>
          <fieldset disabled={!editable || pending} className="grid min-w-0 gap-4">
            <label className="grid gap-1.5 text-sm font-medium">Title
              <input aria-label={`Task ${index + 1} title`} required maxLength={120} value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">Description
              <textarea aria-label={`Task ${index + 1} description`} rows={3} maxLength={2000} value={task.description} onChange={(event) => updateTask(index, { description: event.target.value })} className={fieldClass} />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">Priority
                <select aria-label={`Task ${index + 1} priority`} value={task.priority} onChange={(event) => updateTask(index, { priority: event.target.value as GeneratedTask["priority"] })} className={fieldClass}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">Estimated person-days
                <input aria-label={`Task ${index + 1} effort`} type="number" min={0.25} max={60} step="any" value={Number.isFinite(task.estimatedDays) ? task.estimatedDays : ""}
                  onChange={(event) => updateTask(index, { estimatedDays: event.target.valueAsNumber })} className={fieldClass} />
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">Suggested role
                <input aria-label={`Task ${index + 1} role`} maxLength={80} value={task.suggestedRole} onChange={(event) => updateTask(index, { suggestedRole: event.target.value })} className={fieldClass} />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">Acceptance criteria (one per line, up to 8)
              <textarea aria-label={`Task ${index + 1} criteria`} rows={3} maxLength={2007} value={task.acceptanceCriteria.join("\n")}
                onChange={(event) => updateTask(index, { acceptanceCriteria: event.target.value.split("\n") })} className={fieldClass} />
            </label>
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Prerequisites ({task.dependsOn.length})</summary>
              <div className="mt-3 grid gap-2">
                {plan.tasks.filter((other) => other.tempId !== task.tempId).map((other) => (
                  <label key={other.tempId} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={task.dependsOn.includes(other.tempId)}
                      onChange={(event) => updateTask(index, { dependsOn: event.target.checked ? [...task.dependsOn, other.tempId] : task.dependsOn.filter((id) => id !== other.tempId) })} />
                    <span className="min-w-0 break-words">{other.title || "Untitled task"}</span>
                  </label>
                ))}
                {plan.tasks.length === 1 && <p className="text-xs text-muted-foreground">No other tasks in this draft.</p>}
              </div>
            </details>
          </fieldset>
        </Card>
      ))}
      {editable && <button type="button" disabled={pending || plan.tasks.length >= maxPlanTasks} onClick={() => changePlan({ ...plan, tasks: [...plan.tasks, newDraftTask()] })}
        className="rounded-md border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60">Add manual task</button>}

      <Card className="space-y-3 p-5 sm:p-6">
        <h3 className="font-semibold">Suggested implementation order</h3>
        {invalid ? <p role="alert" className="text-sm text-destructive">{invalid}</p> : (
          <ol className="list-inside list-decimal space-y-1 text-sm">{order.map((id) => <li key={id}>{plan.tasks.find((task) => task.tempId === id)!.title}</li>)}</ol>
        )}
        {editable && (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={reviewed} disabled={pending || Boolean(invalid)} onChange={(event) => setReviewed(event.target.checked)} />
              I reviewed these suggestions and approve creating {plan.tasks.length} project tasks.
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={pending || Boolean(invalid)} onClick={() => submit("save")} className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60">Save draft</button>
              <button type="button" disabled={pending || Boolean(invalid) || !reviewed} onClick={() => submit("approve")} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60">Approve &amp; Create Tasks</button>
              <button type="button" disabled={pending} onClick={() => submit("cancel")} className="rounded px-2 py-2 text-sm font-semibold text-destructive hover:underline disabled:opacity-60">Cancel draft</button>
            </div>
          </>
        )}
        {pending && <p role="status" className="text-sm text-muted-foreground">Saving your request…</p>}
        {notice.error && <p role="alert" className="text-sm text-destructive">{notice.error}</p>}
        {notice.message && <p role="status" className="text-sm text-emerald-800">{notice.message}</p>}
      </Card>
    </section>
  );
}
