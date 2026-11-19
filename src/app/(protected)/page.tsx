import { ActivityFeed } from "@/components/collaboration/activity-feed";
import Link from "next/link";
import { ProjectHealth } from "@/components/intelligence/project-health";
import { RecentProjects, UpcomingTasks, WelcomeBanner } from "@/components/dashboard/dashboard-panels";
import { TaskOverview, WorkspaceStats } from "@/components/dashboard/workspace-stats";
import { PageHeading } from "@/components/layout/page-heading";
import { Card } from "@/components/ui/card";
import { primaryLinkClass } from "@/components/workspaces/styles";
import { requireAuth } from "@/lib/auth/session";
import { getDashboardTasks } from "@/lib/tasks/queries";
import { getProjects, getWorkspaceContext } from "@/lib/workspaces/queries";

export default async function DashboardPage() {
  const [profile, { active, error }] = await Promise.all([requireAuth(), getWorkspaceContext()]);
  const [result, taskData] = active ? await Promise.all([getProjects(active.id), getDashboardTasks(active.id, profile.id)]) : [null, null];

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeading title="Dashboard" description={active ? `${active.name} at a glance.` : "Your workspace at a glance."} />
      <WelcomeBanner name={profile.name} workspaceName={active?.name} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!active && !error && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Get started with a workspace</h2>
          <p className="text-sm text-muted-foreground">Create a workspace or accept an invitation to see your projects.</p>
          <Link href="/workspaces" className={primaryLinkClass}>Open workspaces</Link>
        </Card>
      )}
      {active && (
        <>
          <WorkspaceStats projectCount={result?.error ? null : result?.count ?? 0} tasks={taskData?.counts ?? null} />
          {result?.error && <p role="alert" className="text-sm text-destructive">Could not load workspace projects. Refresh to try again.</p>}
          <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="min-w-0">{result && !result.error && <RecentProjects projects={result.projects} />}</div>
            <TaskOverview tasks={taskData?.counts ?? null}/>
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {taskData?.error ? <p role="alert" className="text-sm text-destructive">Could not load task data. Check that the Phase 4 migration is applied.</p> : <UpcomingTasks tasks={taskData?.upcoming ?? []} />}
            <ProjectHealth workspaceId={active.id}/>
          </div>
          {result && !result.error && <div className="max-h-[480px] overflow-y-auto rounded-2xl"><ActivityFeed workspaceId={active.id}/></div>}
        </>
      )}
    </div>
  );
}
