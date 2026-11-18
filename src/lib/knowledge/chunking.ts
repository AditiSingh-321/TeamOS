import { createHash } from "node:crypto";
import { Tiktoken } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";
import type { Chunk, Passage } from "./validation";
import { KnowledgeError } from "./validation";
let tokenizer: Tiktoken | undefined;
const encoding = () => tokenizer ??= new Tiktoken(cl100kBase);
export const hashContent = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const tokenCount = (value: string) => encoding().encode(value, [], []).length;
export function cleanText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export function chunkPassages(passages: Passage[], size = 650, overlap = 100): Chunk[] {
  if (!Number.isInteger(size) || size < 100 || size > 800 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) throw new KnowledgeError("Invalid chunk configuration.");
  const chunks: Chunk[] = [];
  const seen = new Set<string>();
  for (const passage of passages) {
    const text = cleanText(passage.content);
    const tokens = encoding().encode(text, [], []);
    for (let offset = 0; offset < tokens.length; offset += size - overlap) {
      let start = offset, end = Math.min(tokens.length, offset + size);
      // Token boundaries can split a multibyte Unicode character. Keep valid text.
      while (start < end && encoding().decode(tokens.slice(start, end)).startsWith("\uFFFD")) start++;
      while (end > start && encoding().decode(tokens.slice(start, end)).endsWith("\uFFFD")) end--;
      const content = cleanText(encoding().decode(tokens.slice(start, end)));
      if (!content) continue;
      const hash = hashContent(content);
      if (!seen.has(hash)) { chunks.push({ ...passage, content, chunk_index: chunks.length, content_hash: hash }); seen.add(hash); }
      if (chunks.length > 200) throw new KnowledgeError("Document exceeds the 200-chunk processing limit. Split it into smaller files.");
      if (offset + size >= tokens.length) break;
    }
  }
  if (!chunks.length) throw new KnowledgeError("No readable text was found. Empty documents cannot be indexed.");
  return chunks;
}
