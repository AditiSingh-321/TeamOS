import { Badge } from "@/components/ui/badge";
import type { Priority, TaskStatus } from "@/types/workspace";

const priorityTones = { High: "red", Medium: "amber", Low: "default" } as const;
const statusTones = { Completed: "green", "In progress": "blue", "To do": "default" } as const;

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={priorityTones[priority]}>{priority}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={statusTones[status]}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{status}</Badge>;
}
