import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { KnowledgeError } from "./validation";
import { embeddingModel, embeddingDimensions } from "./config";
export { embeddingModel } from "./config";
export function knowledgeConfiguration() {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (process.env.SARVAM_EMBEDDING_MODEL && process.env.SARVAM_EMBEDDING_MODEL !== embeddingModel) throw new KnowledgeError("RAG requires embeddinggemma-2 with 768 dimensions. A model change needs a new index.", 503);
  if (!key || ["replace_me", "your_sarvam_api_key"].includes(key)) throw new KnowledgeError("Configure SARVAM_API_KEY on the server to use document search.", 503);
  return { key, model: process.env.SARVAM_MODEL?.trim() || "sarvam-105b" };
}
export function knowledgeClient() {
  const config = knowledgeConfiguration();
  return new OpenAI({ apiKey: config.key, baseURL: "https://api.sarvam.ai/v2", defaultHeaders: { "api-subscription-key": config.key }, timeout: 45_000, maxRetries: 1 });
}
export function providerFailure(error: unknown): KnowledgeError {
  if (error instanceof KnowledgeError) return error;
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return new KnowledgeError("Sarvam authentication or model access failed. Check the server API configuration.", 503);
  if (error instanceof OpenAI.APIError && error.status === 402) return new KnowledgeError("Sarvam credits are exhausted. Check your Sarvam dashboard.", 503);
  if (error instanceof OpenAI.APIError && ((error.status === 400 && /provisioned throughput/i.test(error.message)) || error.status === 404)) return new KnowledgeError("Sarvam embedding/model access is not enabled. Use RAG_RETRIEVAL_MODE=fulltext, or request embeddinggemma-2 access from Sarvam.", 503);
  if (error instanceof OpenAI.RateLimitError) return new KnowledgeError("Sarvam quota or rate limit reached. Check API billing and retry later.", 503, error.code !== "insufficient_quota" && error.code !== "credit_balance_exhausted");
  return new KnowledgeError("The AI service could not complete this request. Please retry.", 503, false);
}
export async function embedTexts(texts: string[], client = knowledgeClient(), purpose: "document" | "query" = "document") {
  if (!texts.length || texts.length > 32 || texts.some((text) => !text.trim())) throw new KnowledgeError("Invalid embedding batch.");
  try {
    const result = await client.embeddings.create({ model: embeddingModel, input: texts.map((text) => purpose === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`), encoding_format: "float" });
    const rows = [...result.data].sort((a, b) => a.index - b.index);
    if (rows.length !== texts.length || rows.some((row, i) => row.index !== i || row.embedding.length !== embeddingDimensions || row.embedding.some((n) => !Number.isFinite(n))) ) throw new KnowledgeError("The embedding service returned invalid vectors.", 503, false);
    return rows.map((row) => row.embedding);
  } catch (error) { throw providerFailure(error); }
}
export const answerSchema = z.strictObject({
  supported: z.boolean(), claims: z.array(z.strictObject({ text: z.string().min(1).max(1500), evidence: z.array(z.strictObject({ source: z.number().int().min(1).max(8), quote: z.string().min(12).max(1000) })).min(1).max(8) })).max(8),
});
export async function structuredResponse<T extends z.ZodType>(schema: T, name: string, system: string, input: unknown, client = knowledgeClient()): Promise<z.infer<T>> {
  try {
    const response = await client.responses.parse({ model: knowledgeConfiguration().model, store: false, max_output_tokens: 2500,
      input: [{ role: "developer", content: system }, { role: "user", content: JSON.stringify(input) }],
      text: { format: zodTextFormat(schema, name) },
    });
    if (response.status !== "completed" || !response.output_parsed) throw new KnowledgeError("The assistant could not complete its answer. Try a shorter question.", 503, false);
    return schema.parse(response.output_parsed);
  } catch (error) { throw providerFailure(error); }
}
