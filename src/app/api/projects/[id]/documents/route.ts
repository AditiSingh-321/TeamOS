import { boundedBody, assertSameOrigin, databaseFailure, httpError, projectContext } from "@/lib/knowledge/http";
import { documentBucket, KnowledgeError, maxFileBytes, validateUpload, type DocumentRecord } from "@/lib/knowledge/validation";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { supabase, project } = await projectContext((await context.params).id);
    const { data, error } = await supabase.from("project_documents").select("id,workspace_id,project_id,uploaded_by,uploaded_by_name,filename,storage_path,mime_type,file_size,processing_status,error_message,created_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(100);
    databaseFailure(error);
    return Response.json({ documents: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return httpError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { supabase, project } = await projectContext((await context.params).id);
    const bytes = await boundedBody(request, maxFileBytes + 65536);
    const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new KnowledgeError("Choose a document to upload.");
    const mime = validateUpload(file.name, file.size);
    const { data, error } = await supabase.rpc("reserve_document", { target_project: project.id, document_name: file.name, document_mime: mime, document_size: file.size });
    databaseFailure(error);
    const doc = data as DocumentRecord;
    const { error: uploadError } = await supabase.storage.from(documentBucket).upload(doc.storage_path, await file.arrayBuffer(), { contentType: mime, upsert: false });
    if (uploadError) {
      await supabase.rpc("delete_document", { target_document: doc.id });
      throw new KnowledgeError("Upload failed. Please try again.", 503);
    }
    const queued = await supabase.rpc("queue_document", { target_document: doc.id });
    databaseFailure(queued.error);
    return Response.json({ document: doc }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return httpError(error); }
}
