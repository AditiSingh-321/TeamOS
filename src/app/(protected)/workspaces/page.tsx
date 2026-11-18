import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { WorkspaceInvitations, WorkspaceList, WorkspaceMembers } from "@/components/workspaces/workspace-panels";
import { getWorkspaceContext, getWorkspacePeople } from "@/lib/workspaces/queries";

export const metadata: Metadata = { title: "Workspaces" };

export default async function WorkspacesPage() {
  const { active, workspaces, error } = await getWorkspaceContext();
  const people = error ? null : await getWorkspacePeople(active);

  return (
    <div className="space-y-6">
      <PageHeading title="Workspaces" description="Switch between teams and manage workspace access." />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {people && (
        <>
          <WorkspaceList workspaces={workspaces} active={active} />
          {people.error && <p role="alert" className="text-sm text-destructive">Some membership or invitation data could not be loaded.</p>}
          {active && <WorkspaceMembers active={active} members={people.members} />}
          <WorkspaceInvitations active={active} pending={people.pending} received={people.received} />
        </>
      )}
    </div>
  );
}
