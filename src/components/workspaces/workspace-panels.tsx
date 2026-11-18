import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/workspace";
import { acceptWorkspaceInvitation, changeMemberRole, createWorkspace, inviteToWorkspace, revokeWorkspaceInvitation, switchWorkspace } from "@/lib/workspaces/actions";
import { canManageWorkspace, roleLabels } from "@/lib/workspaces/roles";
import type { ReceivedInvitation, WorkspaceInvitation, WorkspaceMember, WorkspaceSummary } from "@/types/team";
import { fieldClass } from "./styles";
import { WorkspaceForm } from "./workspace-form";

export function WorkspaceList({ workspaces, active }: { workspaces: WorkspaceSummary[]; active: WorkspaceSummary | null }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Your workspaces</h2>
        {workspaces.length ? <ul className="divide-y">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="break-words text-sm font-semibold">{workspace.name}</p>
                <Badge variant={workspace.id === active?.id ? "violet" : "default"}>{roleLabels[workspace.role]}</Badge>
              </div>
              {active?.id === workspace.id ? <span className="text-xs font-medium text-muted-foreground">Active</span> : (
                <WorkspaceForm action={switchWorkspace} label="Switch" compact>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                </WorkspaceForm>
              )}
            </li>
          ))}
        </ul> : <p className="text-sm text-muted-foreground">Create a workspace or accept an invitation to get started.</p>}
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Create workspace</h2>
        <WorkspaceForm action={createWorkspace} label="Create workspace">
          <label className="grid gap-1 text-sm font-medium">
            Workspace name
            <input className={fieldClass} name="name" required maxLength={80} placeholder="Product team" />
          </label>
        </WorkspaceForm>
      </Card>
    </div>
  );
}

export function WorkspaceMembers({ active, members }: { active: WorkspaceSummary; members: WorkspaceMember[] }) {
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">{active.name} members</h2>
      <ul className="divide-y">
        {members.map((member) => (
          <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-medium">{member.display_name}</p>
              <Badge>{roleLabels[member.role]}</Badge>
            </div>
            {active.role === "owner" && member.role !== "owner" && (
              <WorkspaceForm key={member.role} action={changeMemberRole} label="Save role" compact>
                <input type="hidden" name="workspaceId" value={active.id} />
                <input type="hidden" name="userId" value={member.user_id} />
                <select name="role" defaultValue={member.role} aria-label={`Role for ${member.display_name}`} className={fieldClass}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </WorkspaceForm>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function WorkspaceInvitations({ active, pending, received }: {
  active: WorkspaceSummary | null;
  pending: WorkspaceInvitation[];
  received: ReceivedInvitation[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Your invitations</h2>
        {received.length ? <ul className="divide-y">
          {received.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="break-words text-sm font-medium">{invite.workspace_name}</p>
                <Badge>{roleLabels[invite.role]}</Badge>
              </div>
              <WorkspaceForm action={acceptWorkspaceInvitation} label="Accept" compact>
                <input type="hidden" name="invitationId" value={invite.id} />
              </WorkspaceForm>
            </li>
          ))}
        </ul> : <p className="text-sm text-muted-foreground">You have no pending invitations.</p>}
      </Card>
      {active && canManageWorkspace(active.role) && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Invite to {active.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ask the recipient to sign in to TeamOS with this verified email and open Workspaces to accept.</p>
          </div>
          <WorkspaceForm action={inviteToWorkspace} label="Create invitation">
            <input type="hidden" name="workspaceId" value={active.id} />
            <label className="grid gap-1 text-sm font-medium">
              Email address
              <input type="email" name="email" required maxLength={254} className={fieldClass} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Role
              <select name="role" className={fieldClass}>
                <option value="member">Member</option>
                {active.role === "owner" && <option value="admin">Admin</option>}
              </select>
            </label>
          </WorkspaceForm>
          {pending.length > 0 && <ul className="divide-y border-t">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">{roleLabels[invite.role]} · Expires {formatDate(invite.expires_at)}</p>
                </div>
                {(active.role === "owner" || invite.role === "member") && (
                  <WorkspaceForm action={revokeWorkspaceInvitation} label="Revoke" compact>
                    <input type="hidden" name="invitationId" value={invite.id} />
                  </WorkspaceForm>
                )}
              </li>
            ))}
          </ul>}
        </Card>
      )}
    </div>
  );
}
