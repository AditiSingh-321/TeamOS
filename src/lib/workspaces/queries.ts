import "server-only";

import { z } from "zod";
import { cookies } from "next/headers";
import { cache } from "react";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
import type { ReceivedInvitation, WorkspaceInvitation, WorkspaceMember, WorkspaceSummary } from "@/types/team";
import type { Project } from "@/types/workspace";
import { canManageWorkspace } from "./roles";
import { idSchema, memberRoleSchema } from "./validation";

export const activeWorkspaceCookie = "teamos-workspace";
const receivedSchema = z.array(z.object({ id: idSchema, workspace_name: z.string(), role: memberRoleSchema })) satisfies z.ZodType<ReceivedInvitation[]>;
const projectFields = "id, name, description, status, deadline, progress, updated_at";

export const getWorkspaceContext = cache(async () => {
  const profile = await requireAuth();
  const supabase = await createAuthClient();
  if (!supabase) return { workspaces: [], active: null, error: "Workspace data is unavailable." };

  const { data, error } = await supabase.from("workspace_members")
    .select("role, workspace:workspaces!inner(id, name)")
    .eq("user_id", profile.id)
    .overrideTypes<{ role: WorkspaceSummary["role"]; workspace: Pick<WorkspaceSummary, "id" | "name"> }[], { merge: false }>();

  if (error) return {
    workspaces: [],
    active: null,
    error: error.code === "PGRST205" || error.code === "42P01"
      ? "Workspace tables are missing. Apply the Phase 3 Supabase migration to get started."
      : "Could not load your workspaces. Refresh to try again.",
  };

  const workspaces = data.map(({ workspace, role }) => ({ ...workspace, role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const selected = (await cookies()).get(activeWorkspaceCookie)?.value;
  return { workspaces, active: workspaces.find(({ id }) => id === selected) ?? workspaces[0] ?? null, error: null };
});

export const projectPageSize = 24;

export async function getProjects(workspaceId: string, page?: number) {
  const supabase = await createAuthClient();
  if (!supabase) return { projects: [], count: 0, error: true };

  const query = supabase.from("projects").select(projectFields, { count: "exact" })
    .eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).order("id");
  const offset = ((page ?? 1) - 1) * projectPageSize;
  const { data, count, error } = await query.range(offset, offset + (page ? projectPageSize : 3) - 1)
    .overrideTypes<Project[], { merge: false }>();
  return { projects: data ?? [], count: count ?? data?.length ?? 0, error: Boolean(error) };
}

export async function getProject(workspaceId: string, projectId: string) {
  const supabase = await createAuthClient();
  if (!supabase) return { project: null, error: true };
  const { data, error } = await supabase.from("projects").select(projectFields)
    .eq("workspace_id", workspaceId).eq("id", projectId).maybeSingle().overrideTypes<Project, { merge: false }>();
  return { project: data, error: Boolean(error) };
}

export async function getWorkspacePeople(active: WorkspaceSummary | null) {
  const supabase = await createAuthClient();
  if (!supabase) return { members: [], pending: [], received: [], error: true };
  const [members, pending, received] = await Promise.all([
    active ? supabase.from("workspace_members").select("user_id, display_name, role")
      .eq("workspace_id", active.id).order("joined_at").order("user_id")
      .overrideTypes<WorkspaceMember[], { merge: false }>() : null,
    active && canManageWorkspace(active.role)
      ? supabase.from("workspace_invitations").select("id, email, role, expires_at")
        .eq("workspace_id", active.id).order("created_at", { ascending: false })
        .overrideTypes<WorkspaceInvitation[], { merge: false }>() : null,
    supabase.rpc("list_my_workspace_invitations"),
  ]);

  const invites = receivedSchema.safeParse(received.data);
  return {
    members: members?.data ?? [],
    pending: pending?.data ?? [],
    received: invites.success ? invites.data : [],
    error: Boolean(members?.error || pending?.error || received.error || !invites.success),
  };
}
