import { z } from "zod";

export const maxFileBytes = 3 * 1024 * 1024;
export const documentBucket = "project-documents";
export const fileTypes: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain", md: "text/markdown",
};
export class KnowledgeError extends Error {
  status: number;
  permanent: boolean;
  constructor(message: string, status = 400, permanent = true) { super(message); this.status = status; this.permanent = permanent; }
}
export function validateUpload(name: string, size: number) {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!fileTypes[extension] || name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(name)) throw new KnowledgeError("Choose a PDF, DOCX, TXT, or Markdown file with a valid filename.");
  if (size < 1) throw new KnowledgeError("The document is empty.");
  if (size > maxFileBytes) throw new KnowledgeError("Documents must be 3 MB or smaller.", 413);
  return fileTypes[extension];
}
export const questionSchema = z.strictObject({
  question: z.string().trim().min(3).max(2000),
  history: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(6000) })).max(6).default([]),
});
export type ChatQuestion = z.infer<typeof questionSchema>;
export interface DocumentRecord {
  id: string; workspace_id: string; project_id: string; uploaded_by: string; uploaded_by_name: string;
  filename: string; storage_path: string; mime_type: string; file_size: number;
  processing_status: "Pending" | "Processing" | "Ready" | "Failed" | "Deleting";
  error_message: string | null; created_at: string;
}
export interface Passage { content: string; page_number: number | null; section_title: string | null }
export interface Chunk extends Passage { chunk_index: number; content_hash: string }
export interface Source extends Passage { id: string; document_id: string; filename: string; similarity: number }
export interface Citation extends Source { marker: number }
export interface ChatAnswer { answer: string; citations: Citation[]; abstained: boolean }
