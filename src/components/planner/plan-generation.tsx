"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/workspaces/styles";
import { generateAiDraft } from "@/lib/planner/actions";
import { planningInputSchema } from "@/lib/planner/schema";
import type { SavedPlan } from "@/types/planner";

export function PlanGeneration({ project, configured, initial }: {
  project: { id: string; name: string; description: string; deadline: string | null };
  configured: boolean;
  initial?: SavedPlan;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="font-semibold">Project brief</h2>
        <p className="mt-1 text-sm text-muted-foreground">Describe the outcome, requirements, and constraints. Generation sends this brief and the project description to Sarvam AI.</p>
      </div>
      {!configured && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Set SARVAM_API_KEY in the server environment to enable generation.</p>}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (inFlight.current) return;
        const form = new FormData(event.currentTarget);
        const optionalNumber = (name: string) => form.get(name) ? Number(form.get(name)) : null;
        const parsed = planningInputSchema.safeParse({
          brief: form.get("brief"),
          teamSize: optionalNumber("teamSize"),
          durationWeeks: optionalNumber("durationWeeks"),
          deadline: form.get("deadline") || null,
          technologyStack: form.get("technologyStack"),
          instructions: form.get("instructions"),
        });
        if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
        inFlight.current = true;
        setError("");
        const requestId = crypto.randomUUID();
        startTransition(async () => {
          try {
            const result = await generateAiDraft(project.id, requestId, parsed.data);
            if (!mounted.current) return;
            if (result.error) { setError(result.error); router.refresh(); }
            else if (result.planId) router.push(`/projects/${project.id}/plan?draft=${result.planId}`, { scroll: false });
          } catch {
            if (mounted.current) {
              setError("The request was interrupted. Check Saved plans before generating again.");
              router.refresh();
            }
          } finally { inFlight.current = false; }
        });
      }}>
        <fieldset disabled={pending || !configured} className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Requirements
            <textarea name="brief" required minLength={20} maxLength={8000} rows={6}
              defaultValue={initial?.brief ?? project.description}
              placeholder="What should this project deliver? Include scope, constraints, and quality expectations."
              className={fieldClass} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm font-medium">Team size (optional)
              <input name="teamSize" type="number" min={1} max={50} step={1} defaultValue={initial?.preferences.teamSize ?? ""} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">Duration in weeks (optional)
              <input name="durationWeeks" type="number" min={1} max={104} step={1} defaultValue={initial?.preferences.durationWeeks ?? ""} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">Deadline (optional)
              <input name="deadline" type="date" min="0001-01-01" max="9999-12-31" defaultValue={initial?.preferences.deadline ?? project.deadline ?? ""} className={fieldClass} />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">Technology stack (optional)
            <input name="technologyStack" maxLength={500} defaultValue={initial?.preferences.technologyStack ?? ""} placeholder="Next.js, Supabase, Stripe…" className={fieldClass} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Additional instructions (optional)
            <textarea name="instructions" maxLength={2000} rows={2} defaultValue={initial?.preferences.instructions ?? ""} className={fieldClass} />
          </label>
          <button type="submit" className="flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 enabled:hover:bg-primary/90">
            {pending ? <LoaderCircle size={16} aria-hidden="true" className="motion-safe:animate-spin" /> : <Sparkles size={16} aria-hidden="true" />}
            {pending ? "Generating plan…" : initial ? "Regenerate as new draft" : "Generate plan"}
          </button>
        </fieldset>
      </form>
      {pending && <p role="status" className="text-sm text-muted-foreground">Planning can take up to 75 seconds. Return to Saved plans if you leave this page.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}
