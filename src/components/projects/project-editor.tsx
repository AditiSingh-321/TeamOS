import { Card } from "@/components/ui/card";
import { WorkspaceForm } from "@/components/workspaces/workspace-form";
import { fieldClass } from "@/components/workspaces/styles";
import { deleteProject, saveProject } from "@/lib/workspaces/actions";
import { projectStatuses } from "@/lib/workspaces/validation";
import type { Project } from "@/types/workspace";

export function ProjectEditor({ workspaceId, project }: { workspaceId: string; project?: Project }) {
  return (
    <div className="grid max-w-2xl gap-5">
      <Card className="p-5 sm:p-6">
        <WorkspaceForm action={saveProject} label={project ? "Save changes" : "Create project"}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          {project && <input type="hidden" name="projectId" value={project.id} />}
          <label className="grid gap-1 text-sm font-medium">
            Project name
            <input name="name" required maxLength={100} defaultValue={project?.name} className={fieldClass} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Description
            <textarea name="description" rows={3} maxLength={2000} defaultValue={project?.description} className={fieldClass} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-medium">
              Status
              <select name="status" defaultValue={project?.status ?? "Planning"} className={fieldClass}>
                {projectStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Deadline
              <input type="date" name="deadline" min="0001-01-01" max="9999-12-31" defaultValue={project?.deadline ?? ""} className={fieldClass} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Progress (%)
              <input type="number" name="progress" required min={0} max={100} step={1} defaultValue={project?.progress ?? 0} className={fieldClass} />
            </label>
          </div>
        </WorkspaceForm>
      </Card>
      {project && (
        <Card className="space-y-3 border-rose-200 p-5 sm:p-6">
          <h2 className="font-semibold">Delete project</h2>
          <WorkspaceForm action={deleteProject} label="Delete project" danger>
            <input type="hidden" name="workspace_id" value={workspaceId} />
            <input type="hidden" name="projectId" value={project.id} />
            <label className="flex items-center gap-2 text-sm">
              <input name="confirm" type="checkbox" required />
              Permanently delete this project
            </label>
          </WorkspaceForm>
        </Card>
      )}
    </div>
  );
}
