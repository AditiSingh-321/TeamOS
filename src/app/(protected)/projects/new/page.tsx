import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/layout/page-heading";
import { ProjectEditor } from "@/components/projects/project-editor";
import { getWorkspaceContext } from "@/lib/workspaces/queries";
import { canManageWorkspace } from "@/lib/workspaces/roles";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const { active } = await getWorkspaceContext();
  if (!active || !canManageWorkspace(active.role)) redirect("/projects");

  return (
    <div className="space-y-6">
      <PageHeading title="New project" description={`Create a project in ${active.name}.`} />
      <ProjectEditor workspaceId={active.id} />
    </div>
  );
}
