import { randomUUID } from "node:crypto";
import { CommentForm } from "@/components/collaboration/comment-form";
import { TaskRisks } from "@/components/intelligence/task-risks";
import { Card } from "@/components/ui/card";
import { WorkspaceForm } from "@/components/workspaces/workspace-form";
import { fieldClass } from "@/components/workspaces/styles";
import { changeTaskStatus, deleteTask, saveTask } from "@/lib/tasks/actions";
import { canEditTask, canMoveTask } from "@/lib/tasks/permissions";
import { formatDate } from "@/lib/workspace";
import { taskPriorities, taskStatuses, type Task, type TaskComment, type TaskProject } from "@/types/task";
import type { WorkspaceMember, WorkspaceSummary } from "@/types/team";
import { PriorityBadge, TaskStatusBadge } from "./task-badges";

function StatusOptions() {
  return taskStatuses.map((status) => <option key={status}>{status}</option>);
}

function MutationFields({ workspaceId, task }: { workspaceId: string; task: Task }) {
  return <>
    <input type="hidden" name="workspaceId" value={workspaceId} />
    <input type="hidden" name="taskId" value={task.id} />
    <input type="hidden" name="updatedAt" value={task.updated_at} />
  </>;
}

export function TaskEditor({ workspaceId, members, projects, task }: {
  workspaceId: string;
  members: WorkspaceMember[];
  projects: TaskProject[];
  task?: Task;
}) {
  return (
    <Card className="p-4">
      <WorkspaceForm key={task?.updated_at} action={saveTask} label={task ? "Save task" : "Create task"}>
        <input type="hidden" name="workspace_id" value={workspaceId} />
        {task && <>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="updatedAt" value={task.updated_at} />
        </>}
        <label className="grid gap-1 text-sm font-medium">Title
          <input name="title" required maxLength={120} defaultValue={task?.title} className={fieldClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium">Description
          <textarea name="description" rows={4} maxLength={5000} defaultValue={task?.description} className={fieldClass} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium">Priority
            <select name="priority" aria-label="Priority" defaultValue={task?.priority ?? "Medium"} className={fieldClass}>
              {taskPriorities.map((priority) => <option key={priority}>{priority}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Status
            <select name="status" aria-label="Status" defaultValue={task?.status ?? "To Do"} className={fieldClass}><StatusOptions /></select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Assignee
            <select name="assignee_id" aria-label="Assignee" defaultValue={task?.assignee_id ?? ""} className={fieldClass}>
              <option value="">Unassigned</option>
              {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Project
            <select name="project_id" aria-label="Project" defaultValue={task?.project_id ?? ""} className={fieldClass}>
              <option value="">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Due date
          <input name="due_date" type="date" min="0001-01-01" max="9999-12-31" defaultValue={task?.due_date ?? ""} className={fieldClass} />
        </label>
      </WorkspaceForm>
    </Card>
  );
}

export function TaskDetails({ workspace, members, projects, task, userId, comments, commentsError }: {
  workspace: WorkspaceSummary;
  members: WorkspaceMember[];
  projects: TaskProject[];
  task: Task;
  userId: string;
  comments: TaskComment[];
  commentsError: boolean;
}) {
  const editable = canEditTask(workspace.role, userId, task);
  const movable = canMoveTask(workspace.role, userId, task);
  const people = new Map(members.map((member) => [member.user_id, member.display_name]));

  return (
    <>
      {editable ? <TaskEditor workspaceId={workspace.id} members={members} projects={projects} task={task} /> : (
        <Card className="space-y-4 p-4">
          <div className="flex gap-2"><TaskStatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></div>
          {task.description && <p className="whitespace-pre-wrap break-words text-sm">{task.description}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Assignee</dt><dd>{task.assignee_id ? people.get(task.assignee_id) ?? "Unassigned" : "Unassigned"}</dd></div>
            <div><dt className="text-muted-foreground">Project</dt><dd>{projects.find((project) => project.id === task.project_id)?.name ?? "No project"}</dd></div>
            <div><dt className="text-muted-foreground">Due date</dt><dd>{task.due_date ? formatDate(task.due_date) : "No due date"}</dd></div>
          </dl>
          {movable && (
            <WorkspaceForm key={task.updated_at} action={changeTaskStatus} label="Update status" compact>
              <MutationFields workspaceId={workspace.id} task={task} />
              <select aria-label="Task status" name="status" defaultValue={task.status} className={fieldClass}><StatusOptions /></select>
            </WorkspaceForm>
          )}
        </Card>
      )}
      <TaskRisks taskId={task.id} editable={movable} />
      <Card className="space-y-4 p-4">
        <h3 className="font-semibold">Comments</h3>
        {commentsError ? <p role="alert" className="text-sm text-destructive">Could not load comments. Refresh to try again.</p> : (
          comments.length > 0 ? (
            <ol className="divide-y">
              {comments.map((comment) => (
                <li key={comment.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="break-words text-sm font-medium">{people.get(comment.author_id ?? "") ?? "Former member"}</p>
                    <time dateTime={comment.created_at} className="text-xs text-muted-foreground">{formatDate(comment.created_at)}</time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
                  {comment.mentions?.length ? <p className="text-xs text-primary">Mentioned: {comment.mentions.map(m=>people.get(m.user_id)??"Former member").join(", ")}</p> : null}
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">No comments yet.</p>
        )}
        <CommentForm workspaceId={workspace.id} taskId={task.id} members={members} requestId={randomUUID()} />
      </Card>
      {editable && (
        <Card className="space-y-3 border-rose-200 p-4">
          <h3 className="font-semibold">Delete task</h3>
          <WorkspaceForm action={deleteTask} label="Delete task" danger>
            <MutationFields workspaceId={workspace.id} task={task} />
            <label className="flex items-center gap-2 text-sm">
              <input name="confirm" type="checkbox" required /> Permanently delete this task and its comments
            </label>
          </WorkspaceForm>
        </Card>
      )}
    </>
  );
}
