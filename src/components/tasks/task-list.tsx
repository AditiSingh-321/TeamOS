import { Circle, CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDate, projectNames } from "@/lib/workspace";
import type { Task } from "@/types/workspace";
import { PriorityBadge, TaskStatusBadge } from "./task-badges";

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,.9fr)] gap-4 border-b bg-background px-5 py-3 text-xs font-medium text-muted-foreground md:grid" aria-hidden="true">
        <span>Task</span><span>Project</span><span>Priority</span><span>Status</span><span>Due date</span>
      </div>
      <ul className="divide-y">
        {tasks.map((task) => {
          const Icon = task.status === "Completed" ? CircleCheck : Circle;
          return (
            <li key={task.id} className="grid grid-cols-2 items-center gap-x-4 gap-y-3 px-5 py-4 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,.9fr)]">
              <span className="col-span-2 flex items-center gap-2.5 font-medium md:col-span-1"><Icon size={16} className={task.status === "Completed" ? "shrink-0 text-emerald-700" : "shrink-0 text-slate-400"} aria-hidden="true" />{task.title}</span>
              <span className="text-muted-foreground"><span className="sr-only">Project </span>{projectNames.get(task.projectId)}</span>
              <span><span className="sr-only">Priority </span><PriorityBadge priority={task.priority} /></span>
              <span><span className="sr-only">Status </span><TaskStatusBadge status={task.status} /></span>
              <span className="text-xs text-muted-foreground"><span className="md:sr-only">Due </span><time dateTime={task.due}>{formatDate(task.due)}</time></span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
