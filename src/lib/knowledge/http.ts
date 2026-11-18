import "server-only";
import { z } from "zod";
import { createAuthClient } from "@/lib/supabase/server";
import { KnowledgeError } from "./validation";
export async function projectContext(projectId: string) {
  if (!z.uuid().safeParse(projectId).success) throw new KnowledgeError("Project unavailable.", 404);
  const supabase = await createAuthClient(true);
  if (!supabase) throw new KnowledgeError("Sign in to continue.", 401);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new KnowledgeError("Sign in to continue.", 401);
  const { data: project } = await supabase.from("projects").select("id,workspace_id,name").eq("id", projectId).maybeSingle();
  if (!project) throw new KnowledgeError("Project unavailable.", 404);
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", project.workspace_id).eq("user_id", user.id).maybeSingle();
  if (!member) throw new KnowledgeError("Project unavailable.", 404);
  return { supabase, user, project, role: String(member.role) };
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new KnowledgeError("Invalid request origin.", 403);
}
export function databaseFailure(error: { code?: string } | null) {
  if (!error) return;
  if (["PGRST202", "PGRST205", "42P01"].includes(error.code ?? "")) throw new KnowledgeError("Apply the Phase 7 Supabase migration first.", 503);
  if (error.code === "42501") throw new KnowledgeError("Document unavailable or permission denied.", 403);
  if (error.code === "P0001") throw new KnowledgeError("The project document or AI request limit was reached. Try again later.", 429);
  throw new KnowledgeError("The document request could not be saved. Refresh and retry.", 503);
}
export function httpError(error: unknown) {
  if (error instanceof KnowledgeError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid request body." }, { status: 400 });
  if (error instanceof z.ZodError) return Response.json({ error: "Check the submitted fields and try again." }, { status: 400 });
  return Response.json({ error: "The request did not complete. Please retry." }, { status: 503 });
}
// Enforce limits even when Content-Length is absent or forged.
export async function boundedBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new KnowledgeError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new KnowledgeError("Request body is missing.");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new KnowledgeError("Request is too large.", 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
