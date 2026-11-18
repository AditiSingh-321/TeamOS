import { z } from "zod";
import { assertSameOrigin, databaseFailure, httpError, projectContext } from "@/lib/knowledge/http";
import { KnowledgeError } from "@/lib/knowledge/validation";
export async function POST(request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    assertSameOrigin(request);
    const { id, documentId } = await context.params;
    const { supabase, project } = await projectContext(id);
    if (!z.uuid().safeParse(documentId).success) throw new KnowledgeError("Document unavailable.", 404);
    const { data: doc } = await supabase.from("project_documents").select("id,processing_status").eq("project_id", project.id).eq("id", documentId).maybeSingle();
    if (!doc || !["Pending", "Failed", "Ready"].includes(doc.processing_status)) throw new KnowledgeError("Only pending, failed, or ready documents can be re-indexed.");
    const { error } = await supabase.rpc("queue_document", { target_document: doc.id });
    databaseFailure(error);
    return Response.json({ queued: true });
  } catch (error) { return httpError(error); }
}
