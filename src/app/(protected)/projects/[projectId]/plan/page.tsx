import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanGeneration } from "@/components/planner/plan-generation";
import { PlanEditor, PlanLifecycle, PlanPoller } from "@/components/planner/plan-editor";
import { PageHeading } from "@/components/layout/page-heading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWorkspaceContext, getProject } from "@/lib/workspaces/queries";
import { canManageWorkspace } from "@/lib/workspaces/roles";
import { idSchema } from "@/lib/workspaces/validation";
import { plannerConfiguration } from "@/lib/planner/sarvam";
import { getSavedPlans } from "@/lib/planner/queries";
import { formatDate } from "@/lib/workspace";

export const maxDuration = 120;

export const metadata: Metadata = { title: "AI Project Planner" };

export default async function PlannerPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const [{ projectId }, query, { active }] = await Promise.all([params, searchParams, getWorkspaceContext()]);
  if (!active || !canManageWorkspace(active.role) || !idSchema.safeParse(projectId).success) notFound();
  const { project, error } = await getProject(active.id, projectId);
  if (error) return <p role="alert" className="text-sm text-destructive">Could not load the project. Refresh to try again.</p>;
  if (!project) notFound();
  const { plans, error: planError } = await getSavedPlans(project.id);
  const selected = query.draft ? plans.find((plan) => plan.id === query.draft) : plans[0];
  const ready = selected?.generated_plan && ["draft", "approved"].includes(selected.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading title="AI Project Planner" description={`Turn a brief into a reviewed execution plan for ${project.name}.`} />
        <Link href="/projects" className="rounded text-sm font-semibold text-primary hover:underline">Back to projects</Link>
      </div>
      {planError ? <p role="alert" className="text-sm text-destructive">{planError}</p> : (
        <>
          <PlanPoller plans={plans} />
          <PlanGeneration key={selected?.id ?? "new"} project={project} configured={Boolean(plannerConfiguration().apiKey)} initial={selected} />
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Saved plans</h2>
            {!plans.length && <p className="text-sm text-muted-foreground">Generated plans will appear here for review.</p>}
            <ul className="flex flex-wrap gap-2">
              {plans.map((plan, index) => (
                <li key={plan.id}>
                  <Link href={`/projects/${project.id}/plan?draft=${plan.id}`} scroll={false} aria-current={plan.id === selected?.id ? "page" : undefined}
                    className={`flex items-center gap-2 ui-secondary hover:bg-accent ${plan.id === selected?.id ? "bg-secondary" : ""}`}>
                    <span>Plan {plans.length - index} · {formatDate(plan.created_at)}</span>
                    <Badge variant={plan.status === "approved" ? "green" : "default"}>{plan.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {query.draft && !selected && <p role="alert" className="text-sm text-destructive">This saved plan is unavailable in the project.</p>}
          {ready && selected ? <PlanEditor key={`${selected.id}:${selected.revision}`} projectId={project.id} saved={selected} />
            : selected && <PlanLifecycle key={`${selected.id}:${selected.revision}`} projectId={project.id} saved={selected} />}
        </>
      )}
    </div>
  );
}
