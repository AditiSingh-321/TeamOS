import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/workspace";
import type { Project, ProjectStatus } from "@/types/workspace";
import { ProjectIcon } from "./project-icon";

const statusTones = { "On track": "green", "At risk": "amber", Planning: "default" } as const;

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={statusTones[status]}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{status}</Badge>;
}

export function ProjectProgress({ project }: { project: Project }) {
  const progress = project.progress;

  return (
    <div>
      <div className="mb-2 flex justify-between text-xs font-medium">
        <span className="text-muted-foreground">Progress</span><span className="tabular-nums">{progress}%</span>
      </div>
      <progress aria-label={`${project.name} progress`} value={progress} max={100} className="block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-violet-500 [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-violet-500" />
    </div>
  );
}

export function ProjectCard({ project, editable }: { project: Project; editable: boolean }) {
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <ProjectIcon name="layers" />
        <ProjectStatusBadge status={project.status} />
      </div>
      <h2 className="text-base font-semibold tracking-tight">{project.name}</h2>
      <p className="mb-5 mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">{project.description}</p>
      <ProjectProgress project={project} />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {project.deadline ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays size={14} aria-hidden="true" />
            <time dateTime={project.deadline}>{formatDate(project.deadline)}</time>
          </span>
        ) : <span className="text-xs text-muted-foreground">No deadline</span>}
        <Link href={`/dependencies?project=${project.id}`} className="rounded text-sm font-semibold text-primary hover:underline">Dependencies</Link>
        {editable && <Link href={`/projects/${project.id}/edit`} aria-label={`Edit ${project.name}`} className="rounded text-sm font-semibold text-primary hover:underline">Edit</Link>}
      </div>
    </Card>
  );
}
