import { createClient } from "@supabase/supabase-js";
import { setTimeout as sleep } from "node:timers/promises";
import { ingestDocument } from "../src/lib/knowledge/ingestion.ts";
import { embeddingModel } from "../src/lib/knowledge/config.ts";
import { embedTexts } from "../src/lib/knowledge/provider.ts";
import { KnowledgeError, documentBucket } from "../src/lib/knowledge/validation.ts";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || key === "replace_me") { console.error("Configure NEXT_PUBLIC_SUPABASE_URL and the server-only SUPABASE_SERVICE_ROLE_KEY for the document worker."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
const once = process.argv.includes("--once");
async function rpc(name, args) { const { data, error } = await db.rpc(name, args); if (error) throw new Error("Document queue operation failed."); return data; }
async function run() {
  const record = await rpc("claim_document_job");
  if (!record) return false;
  const { job, document } = record;
  const args = { job_id: job.id, token: job.lease_token };
  try {
    if (job.kind === "cleanup") {
      const { error } = await db.storage.from(documentBucket).remove([job.storage_path]);
      if (error) throw new KnowledgeError("File cleanup failed; scheduled for retry.", 503, false);
      await rpc("finish_document_job", args);
    } else {
      await ingestDocument(document, {
        download: async () => {
          const { data, error } = await db.storage.from(documentBucket).download(job.storage_path);
          if (error || !data) throw new KnowledgeError("Private file download failed; scheduled for retry.", 503, false);
          return Buffer.from(await data.arrayBuffer());
        },
        cached: async () => {
          const { data, error } = await db.from("document_chunks").select("content_hash,embedding,embedding_model").eq("document_id", document.id).eq("embedding_model", embeddingModel);
          if (error) throw new Error("Embedding cache is unavailable.");
          return (data ?? []).map((row) => ({ ...row, embedding: typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding }));
        },
        embed: embedTexts,
        checkpoint: async (chunks) => { if (!await rpc("checkpoint_document_embeddings", { ...args, chunks })) throw new KnowledgeError("Processing was cancelled."); },
        finish: (chunks, hash) => rpc("finish_document_job", { ...args, chunks, file_hash: hash }),
      });
    }
    console.log(`Completed ${job.kind} job ${job.id}.`);
  } catch (error) {
    const safe = error instanceof KnowledgeError ? error : new KnowledgeError("Document processing failed. Please retry; check worker connectivity if it persists.", 503, false);
    await rpc("fail_document_job", { ...args, safe_error: safe.message, permanent: safe.permanent });
    console.error(`Job ${job.id}: ${safe.message}`);
  }
  return true;
}
do {
  try { const worked = await run(); if (!worked && !once && !stopping) await sleep(3000); }
  catch { console.error("Cannot reach the document queue. Check the Phase 7 migration and worker credentials."); if (once) process.exitCode = 1; else if (!stopping) await sleep(5000); }
} while (!once && !stopping);
