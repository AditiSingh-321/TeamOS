import { KnowledgeError } from "./validation";
export const embeddingModel = "embeddinggemma-2";
export const embeddingDimensions = 768;
export function retrievalMode(): "fulltext" | "semantic" {
  const mode = process.env.RAG_RETRIEVAL_MODE?.trim() || "fulltext";
  if (mode !== "fulltext" && mode !== "semantic") throw new KnowledgeError("RAG_RETRIEVAL_MODE must be fulltext or semantic.", 503);
  return mode;
}
