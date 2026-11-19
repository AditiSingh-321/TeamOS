import { GitBranch } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectPresence } from "@/components/collaboration/project-presence";
import { riskSummary } from "@/lib/intelligence/queries";
import type { Metadata } from "next";
import Link from "next/link";
import { DependencyGraph } from "@/components/dependencies/dependency-graph";
import { PageHeading } from "@/components/layout/page-heading";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { TaskDetails } from "@/components/tasks/task-details";
import { Card } from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/session";
import { topologicalSort } from "@/lib/dependencies/graph";
import { getDependencies } from "@/lib/dependencies/queries";
import { getTaskBoard, getTaskComments } from "@/lib/tasks/queries";
import { getWorkspaceContext } from "@/lib/workspaces/queries";

export const metadata: Metadata = { title: "Task Dependencies" };

export default async function DependenciesPage({ searchParams }: {
  searchParams: Promise<{ project?: string; task?: string }>;
}) {
  const [profile, { active, error }, params] = await Promise.all([requireAuth(), getWorkspaceContext(), searchParams]);
  const board = active ? await getTaskBoard(active.id) : null;
  const project = board?.projects.find((entry) => entry.id === params.project);
  const graph = active && project ? await getDependencies(active.id, project.id) : null;
  const risks = active && project ? await riskSummary(active.id,project.id) : null;
  const tasks = board?.tasks.filter((task) => task.project_id === project?.id) ?? [];
  const selected = tasks.find((task) => task.id === params.task);
  const comments = active && selected ? await getTaskComments(active.id, selected.id) : null;
  const closeHref = `/dependencies?project=${project?.id ?? ""}`;
  let graphError = graph?.error;
  if (graph && !graph.error) {
    try { topologicalSort(tasks, graph.edges); }
    catch { graphError = "The graph changed while loading. Refresh to load the latest project tasks and dependencies."; }
  }

  return (
    <div className="space-y-6">
      <PageHeading title="Task Dependencies" description="Connect project tasks and inspect prerequisites and delay impact." />
      {(error || board?.error) && <p role="alert" className="text-sm text-destructive">{error ?? board?.error}</p>}
      {!active && !error && <Link href="/workspaces" className="rounded text-sm font-semibold text-primary hover:underline">Choose a workspace</Link>}
      {board && !board.error && (
        <>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Choose a project</h2>
            <nav aria-label="Dependency projects" className="flex flex-wrap gap-2">
              {board.projects.map((entry) => (
                <Link key={entry.id} href={`/dependencies?project=${entry.id}`} aria-current={entry.id === project?.id ? "page" : undefined}
                  className={`max-w-full break-words ui-secondary font-medium hover:bg-accent ${entry.id === project?.id ? "bg-secondary text-secondary-foreground" : ""}`}>{entry.name}</Link>
              ))}
            </nav>
            {!board.projects.length && <p className="text-sm text-muted-foreground">Create a project and add tasks to start a dependency graph.</p>}
          </Card>
          {!project && board.projects.length > 0 && <p className="text-sm text-muted-foreground">{params.project ? "This project is unavailable in the active workspace." : "Choose a project to view its graph."}</p>}
        </>
      )}
      {active && project && <ProjectPresence workspaceId={active.id} projectId={project.id} />}
      {graphError && <p role="alert" className="text-sm text-destructive">{graphError}</p>}
      {active && project && graph && !graphError && (
        tasks.length ? <DependencyGraph key={JSON.stringify([project.id, tasks, graph.edges])} tasks={tasks} edges={graph.edges} riskSources={risks?.sources??[]} riskAffected={risks?.affected_ids??[]} workspace={active} projectId={project.id} userId={profile.id} />
          : <Card><EmptyState icon={GitBranch} title="Connect your project’s next steps" description="Add tasks to this project, then link prerequisites to see blockers and downstream impact."><Link href="/my-tasks?task=new" className="ui-primary">Create a task</Link></EmptyState></Card>
      )}
      {active && board && project && selected && comments && (
        <TaskDrawer key={selected.id} title={selected.title} closeHref={closeHref}>
          <TaskDetails workspace={active} task={selected} userId={profile.id} members={board.members} projects={board.projects}
            comments={comments.rows} commentsError={Boolean(comments.error)} />
        </TaskDrawer>
      )}
      {params.task && project && !selected && !board?.error && <p role="alert" className="text-sm text-destructive">This task is unavailable in the selected project.</p>}
    </div>
  );
}
