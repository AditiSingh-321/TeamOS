import Link from "next/link";
import { RecentActivity, RecentProjects, UpcomingTasks, WelcomeBanner } from "@/components/dashboard/dashboard-panels";
import { WorkspaceStats } from "@/components/dashboard/workspace-stats";
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
      <WelcomeBanner name={profile.name} />
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
          <div className="grid items-start gap-5 min-[1120px]:grid-cols-[1.2fr_1fr]">
            {result && !result.error && <RecentProjects projects={result.projects} />}
            {taskData?.error ? <p role="alert" className="text-sm text-destructive">Could not load task data. Check that the Phase 4 migration is applied.</p> : <UpcomingTasks tasks={taskData?.upcoming ?? []} />}
          </div>
          {result && !result.error && <RecentActivity projects={result.projects} />}
        </>
      )}
    </div>
  );
}
