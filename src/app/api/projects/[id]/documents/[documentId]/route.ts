import { z } from "zod";
import { assertSameOrigin, databaseFailure, httpError, projectContext } from "@/lib/knowledge/http";
import { documentBucket, KnowledgeError } from "@/lib/knowledge/validation";
type Context = { params: Promise<{ id: string; documentId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { id, documentId } = await context.params;
    const { supabase, project } = await projectContext(id);
    if (!z.uuid().safeParse(documentId).success) throw new KnowledgeError("Document unavailable.", 404);
    const { data: doc, error } = await supabase.from("project_documents").select("storage_path,filename,mime_type").eq("project_id", project.id).eq("id", documentId).maybeSingle();
    databaseFailure(error);
    if (!doc) throw new KnowledgeError("Document unavailable.", 404);
    const download = new URL(request.url).searchParams.get("download") === "1" || doc.mime_type !== "application/pdf";
    const signed = await supabase.storage.from(documentBucket).createSignedUrl(doc.storage_path, 60, download ? { download: doc.filename } : undefined);
    if (signed.error || !signed.data) throw new KnowledgeError("The document could not be opened. Retry shortly.", 503);
    return new Response(null, { status: 302, headers: { Location: signed.data.signedUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return httpError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { id, documentId } = await context.params;
    const { supabase, project } = await projectContext(id);
    if (!z.uuid().safeParse(documentId).success) throw new KnowledgeError("Document unavailable.", 404);
    const { data: doc } = await supabase.from("project_documents").select("id").eq("project_id", project.id).eq("id", documentId).maybeSingle();
    if (!doc) throw new KnowledgeError("Document unavailable.", 404);
    const { error } = await supabase.rpc("delete_document", { target_document: doc.id });
    databaseFailure(error);
    return Response.json({ deleted: true });
  } catch (error) { return httpError(error); }
}
