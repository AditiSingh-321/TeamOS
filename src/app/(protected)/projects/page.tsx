import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/layout/page-heading";
import { ProjectCard } from "@/components/projects/project-card";
import { Card } from "@/components/ui/card";
import { primaryLinkClass } from "@/components/workspaces/styles";
import { getProjects, getWorkspaceContext, projectPageSize } from "@/lib/workspaces/queries";
import { canManageWorkspace } from "@/lib/workspaces/roles";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { active, error } = await getWorkspaceContext();
  const { page: requestedPage } = await searchParams;
  const page = requestedPage && /^[1-9]\d{0,5}$/.test(requestedPage) ? Number(requestedPage) : 1;
  const result = active ? await getProjects(active.id, page) : null;
  const editable = active ? canManageWorkspace(active.role) : false;
  const pages = Math.max(1, Math.ceil((result?.count ?? 0) / projectPageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading title="Projects" description={active ? `Track projects in ${active.name}.` : "Choose a workspace to see its projects."} />
        {editable && <Link href="/projects/new" className={primaryLinkClass}>New project</Link>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!active && !error && <Link href="/workspaces" className={primaryLinkClass}>Open workspaces</Link>}
      {result?.error && <p role="alert" className="text-sm text-destructive">Could not load projects. Refresh to try again.</p>}
      {result && !result.error && (result.projects.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {result.projects.map((project) => <li key={project.id}><ProjectCard project={project} editable={editable} /></li>)}
        </ul>
      ) : <Card className="p-5 text-sm text-muted-foreground">{result.count ? "No projects on this page." : "This workspace has no projects yet."}</Card>)}
      {result && !result.error && (pages > 1 || page > 1) && (
        <nav aria-label="Project pages" className="flex flex-wrap items-center gap-4 text-sm">
          {page > 1 && <Link href={`/projects?page=${Math.min(page - 1, pages)}`} className="text-primary hover:underline">Previous</Link>}
          {page <= pages && <span className="text-muted-foreground">Page {page} of {pages}</span>}
          {page < pages && <Link href={`/projects?page=${page + 1}`} className="text-primary hover:underline">Next</Link>}
        </nav>
      )}
    </div>
  );
}
