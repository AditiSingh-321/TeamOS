import { ArrowUpRight, CalendarDays, Circle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProjectProgress, ProjectStatusBadge } from "@/components/projects/project-card";
import { ProjectIcon } from "@/components/projects/project-icon";
import { PriorityBadge } from "@/components/tasks/task-badges";
import { Card } from "@/components/ui/card";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { activity, currentUser, projects, workspace } from "@/data/workspace";
import { formatDate, myTasks, projectNames } from "@/lib/workspace";

function DashboardPanel({ title, link, children }: { title: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-5">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {link && <Link href={link.href} className="inline-flex items-center gap-1 rounded text-xs font-semibold text-primary hover:underline">{link.label}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
        </div>
        {children}
      </Card>
    </section>
  );
}

export function WelcomeBanner() {
  return (
    <section aria-labelledby="welcome-heading" className="relative isolate overflow-hidden rounded-lg border border-violet-200/70 bg-[#efebfc] px-5 py-6 sm:px-7 sm:py-7">
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[44%] bg-[radial-gradient(#ad97df_1px,transparent_1px)] [background-size:16px_16px] [mask-image:linear-gradient(to_right,transparent,black)] sm:block">
        <div className="absolute -right-3 -top-24 size-72 rounded-full border border-violet-300/75 bg-violet-200/25" />
        <div className="absolute -right-14 -top-12 size-72 rounded-full border border-violet-300/75 bg-violet-200/25" />
        <div className="absolute -right-24 top-0 size-72 rounded-full border border-violet-300/75 bg-violet-200/25" />
      </div>
      <p className="mb-2.5 flex items-center gap-2 text-xs font-medium text-violet-800">
        <CalendarDays size={15} aria-hidden="true" />
        <time dateTime={workspace.date}>{formatDate(workspace.date, { weekday: "long", month: "long", day: "numeric" })}</time>
      </p>
      <h2 id="welcome-heading" className="text-2xl font-semibold tracking-[-0.04em] sm:text-[1.75rem]">Welcome back, {currentUser.name.split(" ")[0]}</h2>
      <p className="mt-1.5 text-sm text-[#544b71]">Here&apos;s what&apos;s happening across your workspace.</p>
    </section>
  );
}

export function RecentProjects() {
  const recentProjects = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);

  return (
    <DashboardPanel title="Recent Projects" link={{ href: "/projects", label: "View projects" }}>
      <ul className="divide-y">
        {recentProjects.map((project) => (
          <li key={project.id} className="grid gap-3 px-4 py-3.5 sm:px-5 xl:grid-cols-[minmax(0,1fr)_minmax(100px,.55fr)] xl:items-center xl:gap-4">
            <div className="flex items-center gap-3">
              <ProjectIcon name={project.icon} />
              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-semibold leading-tight">{project.name}</p>
                <ProjectStatusBadge status={project.status} />
              </div>
            </div>
            <ProjectProgress project={project} />
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}

export function UpcomingTasks() {
  const upcoming = myTasks.filter((task) => task.status !== "Completed" && task.due >= workspace.date).slice(0, 4);

  return (
    <DashboardPanel title="My Upcoming Tasks" link={{ href: "/my-tasks", label: "View tasks" }}>
      <ul className="divide-y">
        {upcoming.map((task) => (
          <li key={task.id} className="flex items-start gap-2.5 px-4 py-3.5 sm:px-5">
            <Circle size={15} className="mt-0.5 shrink-0 text-violet-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight">{task.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{projectNames.get(task.projectId)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <PriorityBadge priority={task.priority} />
              <time dateTime={task.due} className="text-[11px] text-muted-foreground">{task.due === workspace.date ? "Today" : formatDate(task.due, { month: "short", day: "numeric" })}</time>
            </div>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}

export function RecentActivity() {
  return (
    <DashboardPanel title="Recent Activity">
      <ul className="divide-y">
        {activity.map(({ id, person, action, subject, time }) => (
          <li key={id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <MemberAvatar member={person} />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{person.name}</span> {action} <span className="font-medium text-foreground">{subject}</span></p>
              <p className="text-xs text-muted-foreground">{time}</p>
            </div>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
