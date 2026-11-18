import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/layout/page-heading";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskDetails, TaskEditor } from "@/components/tasks/task-details";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { primaryLinkClass } from "@/components/workspaces/styles";
import { requireAuth } from "@/lib/auth/session";
import { getTaskBoard, getTaskComments } from "@/lib/tasks/queries";
import { getWorkspaceContext } from "@/lib/workspaces/queries";
import { idSchema } from "@/lib/workspaces/validation";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage({ searchParams }: {
  searchParams: Promise<{ task?: string; mine?: string }>;
}) {
  const [profile, { active, error }, { task, mine }] = await Promise.all([requireAuth(), getWorkspaceContext(), searchParams]);
  const board = active ? await getTaskBoard(active.id) : null;
  const taskId = idSchema.safeParse(task);
  const selected = taskId.success ? board?.tasks.find(({ id }) => id === taskId.data) : null;
  const comments = selected && active ? await getTaskComments(active.id, selected.id) : null;
  const closeHref = mine === "1" ? "/my-tasks?mine=1" : "/my-tasks";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading title="My Tasks" description={active ? `Track and assign tasks in ${active.name}.` : "Choose a workspace to see its tasks."} />
        {board && !board.error && <Link href={`/my-tasks?task=new${mine === "1" ? "&mine=1" : ""}`} scroll={false} className={primaryLinkClass}>New task</Link>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!active && !error && <Link href="/workspaces" className={primaryLinkClass}>Open workspaces</Link>}
      {board?.error && <p role="alert" className="text-sm text-destructive">{board.error}</p>}
      {active && board && !board.error && (
        <>
          <TaskBoard key={`${active.id}:${mine === "1"}`} workspace={active} userId={profile.id} mine={mine === "1"} {...board} />
          {task === "new" && <TaskDrawer key="new" title="New task" closeHref={closeHref}><TaskEditor workspaceId={active.id} members={board.members} projects={board.projects} /></TaskDrawer>}
          {selected && comments && (
            <TaskDrawer key={selected.id} title={selected.title} closeHref={closeHref}>
              <TaskDetails workspace={active} task={selected} userId={profile.id} members={board.members} projects={board.projects}
                comments={comments.rows} commentsError={Boolean(comments.error)} />
            </TaskDrawer>
          )}
          {task && task !== "new" && !selected && <p role="alert" className="text-sm text-destructive">This task is unavailable in the active workspace.</p>}
        </>
      )}
    </div>
  );
}
