export type WorkspaceRole = "owner" | "admin" | "member";
export type InviteRole = Exclude<WorkspaceRole, "owner">;

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  user_id: string;
  display_name: string;
  role: WorkspaceRole;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: InviteRole;
  expires_at: string;
}

export interface ReceivedInvitation {
  id: string;
  workspace_name: string;
  role: InviteRole;
}

export interface WorkspaceActionState {
  error?: string;
  message?: string;
}
