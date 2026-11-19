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
      <div className="grid items-start gap-5 xl:grid-cols-[230px_minmax(0,1fr)]">
        <Card className="space-y-4 p-4 xl:sticky xl:top-6">
          <h2 className="panel-heading">Project knowledge</h2>
          <form action={`/${mode}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 xl:block xl:space-y-2">
            <label htmlFor="knowledge-project" className="col-span-2 text-xs text-muted-foreground">Project</label>
            <select id="knowledge-project" name="project" defaultValue={project.id} className="ui-field w-full min-w-0">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="w-full ui-secondary hover:bg-muted">Open project</button>
          </form>
          <Link href={`/${mode === "documents" ? "assistant" : "documents"}?project=${project.id}`} className="block text-xs font-medium text-primary hover:underline">{mode === "documents" ? "Ask about these documents →" : "Manage documents →"}</Link>
          <Link href={`/approvals?project=${project.id}`} className="block text-xs font-medium text-primary hover:underline">Propose project actions →</Link><details className="border-t pt-3 text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer font-medium">How it works</summary><p className="mt-2">Document questions stay read-only. Project changes need explicit proposals and approval.</p></details>
        </Card>
        {mode === "documents" ? <DocumentsPanel key={project.id} project={project} userId={profile.id} manager={active?.role === "owner" || active?.role === "admin"} /> : <AssistantPanel key={project.id} project={project} retrieval={retrievalMode()} />}
      </div>}
  </div>;
}
