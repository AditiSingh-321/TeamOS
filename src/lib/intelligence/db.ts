import { KnowledgeError } from "../knowledge/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
export async function intelligenceRpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new KnowledgeError(error.code === "42501" ? "You do not have permission for this action." : error.code === "40001" ? "This record changed. Refresh and review it again." : ["PGRST202","PGRST205","42P01"].includes(error.code) ? "Apply the intelligence database migrations first." : "The request could not be saved. Refresh and retry.",error.code === "40001" ? 409 : error.code === "42501" ? 403 : 503);
  return data;
}
