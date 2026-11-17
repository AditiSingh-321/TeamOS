import { requireAuth } from "@/lib/auth/session";
import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { ProjectCard } from "@/components/projects/project-card";
import { projects } from "@/data/workspace";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeading title="Projects" description="Browse workspace projects, their teams, and upcoming deadlines." />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => <li key={project.id}><ProjectCard project={project} /></li>)}
      </ul>
    </div>
  );
}
