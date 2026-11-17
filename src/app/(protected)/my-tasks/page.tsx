import { requireAuth } from "@/lib/auth/session";
import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { TaskList } from "@/components/tasks/task-list";
import { currentUser } from "@/data/workspace";
import { myTasks } from "@/lib/workspace";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage() {
  await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeading title="My Tasks" description={`Tasks assigned to ${currentUser.name}, ordered by due date.`} />
      <TaskList tasks={myTasks} />
    </div>
  );
}
