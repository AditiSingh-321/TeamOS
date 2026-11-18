import Link from "next/link";
import { retrievalMode } from "@/lib/knowledge/config";
import { getWorkspaceContext } from "@/lib/workspaces/queries";
import { createAuthClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";
import { PageHeading } from "@/components/layout/page-heading";
import { DocumentsPanel } from "./documents-panel";
import { AssistantPanel } from "./assistant-panel";
import { Card } from "@/components/ui/card";
export async function KnowledgePage({ mode, selected }: { mode: "documents" | "assistant"; selected?: string }) {
  const { active, error } = await getWorkspaceContext();
  const profile = await requireAuth();
  const db = await createAuthClient();
  const result = active && db ? await db.from("projects").select("id,name").eq("workspace_id", active.id).order("name").limit(100) : null;
  const projects = result?.data ?? [];
  const project = projects.find((p) => p.id === selected) ?? projects[0];
  return <div className="space-y-6">
    <PageHeading title={mode === "documents" ? "Documents" : "AI Assistant"} description={mode === "documents" ? "Your project knowledge, organized and searchable." : "Answers grounded in your project's uploaded documents."} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result?.error && <p role="alert" className="text-sm text-destructive">Could not load projects. Refresh to retry.</p>}
    {!project ? <Card className="p-6 text-sm text-muted-foreground">Choose a workspace and create a project before adding documents. <Link href="/projects" className="text-primary hover:underline">Open projects</Link></Card> :
      <div className="grid items-start gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Project knowledge</h2>
          <form action={`/${mode}`} className="space-y-2">
            <label htmlFor="knowledge-project" className="text-xs text-muted-foreground">Project</label>
            <select id="knowledge-project" name="project" defaultValue={project.id} className="w-full min-w-0 rounded-md border bg-background px-2 py-2 text-sm">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted">Open project</button>
          </form>
          <Link href={`/${mode === "documents" ? "assistant" : "documents"}?project=${project.id}`} className="block text-sm text-primary hover:underline">{mode === "documents" ? "Ask about these documents →" : "Manage documents →"}</Link>
          <p className="text-xs leading-relaxed text-muted-foreground">Search and conversations stay within this project.</p>
        </Card>
        {mode === "documents" ? <DocumentsPanel key={project.id} project={project} userId={profile.id} manager={active?.role === "owner" || active?.role === "admin"} /> : <AssistantPanel key={project.id} project={project} retrieval={retrievalMode()} />}
      </div>}
  </div>;
}
