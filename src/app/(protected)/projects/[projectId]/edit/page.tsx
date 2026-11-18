import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/layout/page-heading";
import { ProjectEditor } from "@/components/projects/project-editor";
import { getProject, getWorkspaceContext } from "@/lib/workspaces/queries";
import { canManageWorkspace } from "@/lib/workspaces/roles";
import { createAuthClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/workspaces/validation";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { active } = await getWorkspaceContext();
  const { projectId } = await params;
  if (!active || !canManageWorkspace(active.role) || !idSchema.safeParse(projectId).success) notFound();

  const { project, error } = await getProject(active.id, projectId);
  if (error) return <p role="alert" className="text-sm text-destructive">Could not load the project. Refresh to try again.</p>;
  if (!project) notFound();

  const supabase = await createAuthClient();
  const result = await supabase?.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", active.id).eq("project_id", projectId);

  return (
    <div className="space-y-6">
      <PageHeading title="Edit project" description={`${project.name} · ${active.name}`} />
      <ProjectEditor workspaceId={active.id} project={project} taskCount={result?.count ?? 0} />
    </div>
  );
}
