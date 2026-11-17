import { requireAuth } from "@/lib/auth/session";
import { RecentActivity, RecentProjects, UpcomingTasks, WelcomeBanner } from "@/components/dashboard/dashboard-panels";
import { WorkspaceStats } from "@/components/dashboard/workspace-stats";
import { PageHeading } from "@/components/layout/page-heading";

export default async function DashboardPage() {
  const profile = await requireAuth();

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeading title="Dashboard" description="Your workspace at a glance." />
      <WelcomeBanner name={profile.name} />
      <WorkspaceStats />
      <div className="grid items-start gap-5 min-[1120px]:grid-cols-[1.2fr_1fr]">
        <RecentProjects />
        <UpcomingTasks />
      </div>
      <RecentActivity />
    </div>
  );
}
