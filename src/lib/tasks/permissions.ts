import type { WorkspaceRole } from "@/types/team";
import type { Task } from "@/types/task";
import { canManageWorkspace } from "@/lib/workspaces/roles";

export function canEditTask(role: WorkspaceRole, userId: string, task: Task) {
  return canManageWorkspace(role) || task.created_by === userId;
}

export function canMoveTask(role: WorkspaceRole, userId: string, task: Task) {
  return canEditTask(role, userId, task) || task.assignee_id === userId;
}
