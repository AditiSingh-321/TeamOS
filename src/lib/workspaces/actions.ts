"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
import type { WorkspaceActionState } from "@/types/team";
import { activeWorkspaceCookie } from "./queries";
import { idSchema, invitationSchema, memberRoleSchema, projectSchema, workspaceSchema } from "./validation";

async function authenticatedClient() {
  await requireAuth();
  const supabase = await createAuthClient(true);
  if (!supabase) redirect("/login");
  return supabase;
}

async function selectWorkspace(id: string) {
  (await cookies()).set(activeWorkspaceCookie, id, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

function refreshWorkspace() {
  revalidatePath("/", "layout");
}

export async function createWorkspace(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const input = workspaceSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: input.error.issues[0].message };

  const { data, error } = await supabase.rpc("create_workspace", { workspace_name: input.data.name });
  const workspace = idSchema.safeParse(data);
  if (error || !workspace.success) return { error: "Could not create the workspace. Try again." };

  await selectWorkspace(workspace.data);
  refreshWorkspace();
  return { message: "Workspace created." };
}

export async function switchWorkspace(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const id = idSchema.safeParse(form.get("workspaceId"));
  if (!id.success) return { error: "Choose a workspace." };
  const { data, error } = await supabase.from("workspaces").select("id").eq("id", id.data).maybeSingle();
  if (error || !data) return { error: "That workspace is unavailable." };

  await selectWorkspace(id.data);
  refreshWorkspace();
  redirect("/workspaces");
}

export async function inviteToWorkspace(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const input = invitationSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a valid email address and choose a role." };

  const { workspaceId, email, role } = input.data;
  const { error } = await supabase.from("workspace_invitations").insert({ workspace_id: workspaceId, email, role });
  if (error?.code === "23505") return { error: "An invitation already exists. Revoke it before sending a new one." };
  if (error) return { error: "Could not invite this person. Check your workspace permissions." };
  refreshWorkspace();
  return { message: "Invitation created. The recipient can accept it from Workspaces in TeamOS." };
}

export async function acceptWorkspaceInvitation(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const id = idSchema.safeParse(form.get("invitationId"));
  if (!id.success) return { error: "That invitation is unavailable." };

  const { data, error } = await supabase.rpc("accept_workspace_invitation", { invitation: id.data });
  const workspace = idSchema.safeParse(data);
  if (error || !workspace.success) return { error: "This invitation is unavailable or has expired." };

  await selectWorkspace(workspace.data);
  refreshWorkspace();
  redirect("/workspaces");
}

export async function revokeWorkspaceInvitation(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const id = idSchema.safeParse(form.get("invitationId"));
  if (!id.success) return { error: "That invitation is unavailable." };

  const { data, error } = await supabase.from("workspace_invitations").delete().eq("id", id.data).select("id").maybeSingle();
  if (error || !data) return { error: "Could not revoke this invitation. Check your workspace permissions." };

  refreshWorkspace();
  return { message: "Invitation revoked." };
}

export async function changeMemberRole(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const workspace = idSchema.safeParse(form.get("workspaceId"));
  const user = idSchema.safeParse(form.get("userId"));
  const role = memberRoleSchema.safeParse(form.get("role"));
  if (!workspace.success || !user.success || !role.success) return { error: "Choose a valid member role." };

  const { error } = await supabase.rpc("set_workspace_member_role", {
    target_workspace: workspace.data, target_user: user.data, new_role: role.data,
  });
  if (error) return { error: "Could not change this role. Only the workspace owner can change roles." };
  refreshWorkspace();
  return { message: "Role updated." };
}

export async function saveProject(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const input = projectSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a name, choose a valid status and deadline, and use a whole-number progress value from 0 to 100." };

  const rawId = form.get("projectId");
  const id = idSchema.safeParse(rawId);
  if (rawId !== null && !id.success) return { error: "That project is unavailable." };

  const { workspace_id, ...fields } = input.data;
  const query = id.success
    ? supabase.from("projects").update(fields).eq("id", id.data).eq("workspace_id", workspace_id)
    : supabase.from("projects").insert(input.data);

  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data) return { error: "Could not save this project. Check your workspace permissions." };

  refreshWorkspace();
  redirect("/projects");
}

export async function deleteProject(_state: WorkspaceActionState, form: FormData): Promise<WorkspaceActionState> {
  const supabase = await authenticatedClient();
  const id = idSchema.safeParse(form.get("projectId"));
  const workspace = idSchema.safeParse(form.get("workspace_id"));
  if (!id.success || !workspace.success || form.get("confirm") !== "on") return { error: "Confirm deletion to continue." };

  const { data, error } = await supabase.from("projects").delete()
    .eq("id", id.data).eq("workspace_id", workspace.data).select("id").maybeSingle();

  if (error || !data) return { error: "Could not delete this project. Check your workspace permissions." };
  refreshWorkspace();
  redirect("/projects");
}
