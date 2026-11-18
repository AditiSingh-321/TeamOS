import type { WorkspaceRole } from "@/types/team";

export const roleLabels: Record<WorkspaceRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function canManageWorkspace(role: WorkspaceRole) {
  return role === "owner" || role === "admin";
}
