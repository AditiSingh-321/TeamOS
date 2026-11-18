import { embeddingDimensions, retrievalMode } from "./config";
import { z } from "zod";
import { tokenCount } from "./chunking";
import { answerSchema } from "./provider";
import type { ChatAnswer, ChatQuestion, Source } from "./validation";
import { KnowledgeError, questionSchema } from "./validation";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
export const abstention = "The available project documents do not contain enough information to answer this question.";
export interface RagDependencies {
  authorize: () => Promise<void>; reserve: () => Promise<void>;
  rewrite: (question: string, history: ChatQuestion["history"]) => Promise<string>;
  embed: (texts: string[]) => Promise<number[][]>;
  searchText: (question: string, count: number) => Promise<Source[]>;
  search: (vector: number[], count: number) => Promise<Source[]>;
  answer: (question: string, sources: { marker: number; content: string }[]) => Promise<z.infer<typeof answerSchema>>;
  stillAvailable: (ids: string[]) => Promise<string[]>;
}
export async function answerQuestion(value: unknown, deps: RagDependencies): Promise<ChatAnswer> {
  const input = questionSchema.parse(value);
  await deps.authorize(); await deps.reserve();
  const question = input.history.length ? await deps.rewrite(input.question, input.history) : input.question;
  if (!question.trim() || question.length > 2500) throw new KnowledgeError("Could not resolve this follow-up. Please restate the question.");
  const count = Math.max(1, Math.min(8, Math.floor(Number(process.env.RAG_TOP_K)) || 6));
  let found: Source[];
  if (retrievalMode() === "fulltext") found = await deps.searchText(question, count);
  else {
    const vectors = await deps.embed([question]);
    if (vectors.length !== 1 || vectors[0].length !== embeddingDimensions || vectors[0].some((n) => !Number.isFinite(n))) throw new KnowledgeError("The question embedding is unavailable.", 503);
    found = await deps.search(vectors[0], count);
  }
  let used = 0;
  const sources = found.filter((source) => { const tokens = tokenCount(source.content); if (!source.content.trim() || used + tokens > 5000) return false; used += tokens; return true; }).slice(0, count);
  const empty = { answer: abstention, citations: [], abstained: true };
  if (!sources.length) return empty;
  const result = answerSchema.parse(await deps.answer(question, sources.map((source, i) => ({ marker: i + 1, content: source.content }))));
  if (!result.supported || !result.claims.length) return empty;
  // The model returns only references to our numbered retrieved set; render markers ourselves.
  if (result.claims.some((claim) => claim.evidence.some((ref) => ref.source > sources.length || !normalize(sources[ref.source - 1].content).includes(normalize(ref.quote))) || /\[\d+\]/.test(claim.text))) return empty;
  const indices = [...new Set(result.claims.flatMap((claim) => claim.evidence.map((ref) => ref.source)))].sort((a, b) => a - b);
  const available = new Set(await deps.stillAvailable(indices.map((id) => sources[id - 1].id)));
  if (indices.some((id) => !available.has(sources[id - 1].id))) return empty;
  return {
    answer: result.claims.map((claim) => `${claim.text} ${[...new Set(claim.evidence.map((ref) => ref.source))].map((n) => `[${n}]`).join(" ")}`).join("\n\n"),
    citations: indices.map((id) => ({ ...sources[id - 1], marker: id })), abstained: false,
  };
}
