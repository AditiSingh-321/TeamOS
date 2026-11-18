import { embeddingDimensions, embeddingModel, retrievalMode } from "./config";
import type { Chunk, DocumentRecord } from "./validation";
import { KnowledgeError } from "./validation";
import { extractDocument } from "./extraction";
import { chunkPassages, hashContent } from "./chunking";
export interface IndexedChunk extends Chunk { embedding: number[] | null; embedding_model: string | null }
export interface IngestionDependencies {
  download: () => Promise<Buffer>;
  cached: () => Promise<IndexedChunk[]>;
  embed: (texts: string[]) => Promise<number[][]>;
  checkpoint?: (chunks: IndexedChunk[]) => Promise<void>;
  finish: (chunks: IndexedChunk[], hash: string) => Promise<boolean>;
}
export async function ingestDocument(document: Pick<DocumentRecord, "mime_type" | "file_size">, deps: IngestionDependencies) {
  const bytes = await deps.download();
  if (bytes.length !== document.file_size) throw new KnowledgeError("Stored file size does not match the document. Delete it and upload again.");
  const passages = await extractDocument(bytes, document.mime_type);
  const size = Number(process.env.RAG_CHUNK_TOKENS || 650), overlap = Number(process.env.RAG_CHUNK_OVERLAP || 100);
  const chunks = chunkPassages(passages, size, overlap);
  if (retrievalMode() === "fulltext") return deps.finish(chunks.map((chunk) => ({ ...chunk, embedding: null, embedding_model: null })), hashContent(bytes));
  const cache = new Map((await deps.cached()).filter((chunk) => chunk.embedding_model === embeddingModel && chunk.embedding?.length === embeddingDimensions).map((chunk) => [chunk.content_hash, chunk.embedding!]));
  const missing = chunks.filter((chunk) => !cache.has(chunk.content_hash));
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const vectors = await deps.embed(batch.map((chunk) => chunk.content));
    if (vectors.length !== batch.length) throw new Error("Missing document embeddings.");
    batch.forEach((chunk, index) => cache.set(chunk.content_hash, vectors[index]));
    await deps.checkpoint?.(batch.map((chunk, index) => ({ ...chunk, embedding: vectors[index], embedding_model: embeddingModel })));
  }
  return deps.finish(chunks.map((chunk) => ({ ...chunk, embedding: cache.get(chunk.content_hash)!, embedding_model: embeddingModel })), hashContent(bytes));
}
