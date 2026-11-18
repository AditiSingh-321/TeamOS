"use client";

import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { CalendarDays, GripVertical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/workspaces/styles";
import { moveTask } from "@/lib/tasks/actions";
import { canMoveTask } from "@/lib/tasks/permissions";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/workspace";
import { taskPriorities, taskStatuses, type Task, type TaskProject, type TaskStatus } from "@/types/task";
import type { WorkspaceMember, WorkspaceSummary } from "@/types/team";
import { PriorityBadge, TaskStatusBadge } from "./task-badges";

function Column({ status, count, children }: { status: TaskStatus; count: number; children: ReactNode }) {
  const { ref, isDropTarget } = useDroppable({ id: status, accept: "task" });
  return (
    <section ref={ref} aria-label={status} className={cn("min-h-52 w-64 shrink-0 rounded-lg border bg-muted/55 p-3 xl:w-auto xl:min-w-0", isDropTarget && "border-violet-400 bg-violet-50")}>
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold"><TaskStatusBadge status={status} /></h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
      {!count && <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">No tasks</p>}
    </section>
  );
}

function TaskItem({ task, draggable, project, assignee, href }: {
  task: Task;
  draggable: boolean;
  project?: string;
  assignee?: string;
  href: string;
}) {
  const { ref, handleRef, isDragging } = useDraggable({ id: task.id, type: "task", disabled: !draggable });
  return (
    <li ref={ref} className={cn("break-words", isDragging && "opacity-70")}>
      <Card className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} scroll={false} className="min-w-0 rounded text-sm font-semibold hover:text-primary hover:underline">{task.title}</Link>
          {draggable && (
            <button ref={handleRef} type="button" aria-label={`Drag ${task.title}`} className="shrink-0 touch-none cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing">
              <GripVertical size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {project && <p className="truncate text-xs text-muted-foreground">{project}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={task.priority} />
          {task.due_date && <time dateTime={task.due_date} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays size={13} aria-hidden="true" />{formatDate(task.due_date, { month: "short", day: "numeric" })}</time>}
        </div>
        <p className="truncate text-xs text-muted-foreground">{assignee ?? "Unassigned"}</p>
      </Card>
    </li>
  );
}

export function TaskBoard({ tasks, members, projects, workspace, userId, mine }: {
  tasks: Task[];
  members: WorkspaceMember[];
  projects: TaskProject[];
  workspace: WorkspaceSummary;
  userId: string;
  mine: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState(mine ? userId : "");
  const [notice, setNotice] = useState<{ error?: string; message?: string }>({});
  const [saving, startTransition] = useTransition();
  const [optimisticTasks, showMove] = useOptimistic(tasks, (current, move: { id: string; status: TaskStatus }) =>
    current.map((task) => task.id === move.id ? { ...task, status: move.status } : task)
  );

  const people = new Map(members.map((member) => [member.user_id, member.display_name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const visible = optimisticTasks.filter((task) =>
    (!status || task.status === status) && (!priority || task.priority === priority)
    && (!assignee || (assignee === "unassigned" ? task.assignee_id === null : task.assignee_id === assignee))
  ).sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Status
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
            <option value="">All statuses</option>
            {taskStatuses.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Priority
          <select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)} className={fieldClass}>
            <option value="">All priorities</option>
            {taskPriorities.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="grid max-w-full gap-1 text-xs font-medium text-muted-foreground">
          Assignee
          <select aria-label="Filter by assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)} className={cn(fieldClass, "max-w-52 truncate")}>
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.user_id === userId ? "Assigned to me" : member.display_name}
              </option>
            ))}
          </select>
        </label>
        {(status || priority || assignee) && <button type="button" onClick={() => { setStatus(""); setPriority(""); setAssignee(""); }} className="rounded px-2 py-2 text-sm font-medium text-primary hover:underline">Clear filters</button>}
      </Card>
      {notice.error && <p role="alert" className="text-sm text-destructive">{notice.error}</p>}
      <p role="status" className="sr-only">{saving ? "Saving task status…" : notice.message}</p>
      {tasks.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground">No tasks match these filters.</p>}
      <DragDropProvider onDragEnd={(event) => {
        const { source, target } = event.operation;
        const nextStatus = taskStatuses.find((value) => value === target?.id);
        const task = tasks.find(({ id }) => id === source?.id);
        if (event.canceled || saving || !task || !nextStatus || nextStatus === task.status || !canMoveTask(workspace.role, userId, task)) return;
        setNotice({});
        startTransition(async () => {
          showMove({ id: task.id, status: nextStatus });
          try {
            const result = await moveTask({ workspaceId: workspace.id, taskId: task.id, updatedAt: task.updated_at, status: nextStatus });
            setNotice(result);
            if (result.error) router.refresh();
          } catch {
            setNotice({ error: "Could not move the task. Try again." });
          }
        });
      }}>
        <div className="flex gap-4 overflow-x-auto pb-3 xl:grid xl:grid-cols-4">
          {taskStatuses.map((column) => {
            const entries = visible.filter((task) => task.status === column);
            return (
              <Column key={column} status={column} count={entries.length}>
                <ul className="space-y-2">
                  {entries.map((task) => (
                    <TaskItem key={task.id} task={task} draggable={!saving && canMoveTask(workspace.role, userId, task)}
                      project={task.project_id ? projectNames.get(task.project_id) : undefined}
                      assignee={task.assignee_id ? people.get(task.assignee_id) : undefined}
                      href={`/my-tasks?task=${task.id}${mine ? "&mine=1" : ""}`} />
                  ))}
                </ul>
              </Column>
            );
          })}
        </div>
      </DragDropProvider>
    </div>
  );
}
