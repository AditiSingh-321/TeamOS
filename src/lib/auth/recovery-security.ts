import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const RECOVERY_COOKIE = "teamos-recovery";
export const FLOW_COOKIE = "teamos-recovery-flow";
export const RECOVERY_SECONDS = 15 * 60;
export const RESEND_SECONDS = 60;
const ticketSchema = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("recovery"), uid: z.string(), sid: z.string(), version: z.string(), exp: z.number() }),
  z.object({ purpose: z.literal("request"), email: z.string(), verifier: z.string(), exp: z.number() }),
]);
export type RecoveryTicket = Extract<z.infer<typeof ticketSchema>, { purpose: "recovery" }>;
export type FlowTicket = Extract<z.infer<typeof ticketSchema>, { purpose: "request" }>;
export function recoverySecret() {
  const value = process.env.TEAMOS_RECOVERY_SECRET;
  return value && value.length >= 32 && !value.includes("replace_me") ? value : null;
}
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function emailDigest(value: string) { return digest(value.trim().toLowerCase()); }
export function verifierDigest(cookies: { name: string; value: string }[]) {
  const entries = cookies.filter(c => c.name.includes("auth-token-code-verifier")).sort((a,b) => a.name.localeCompare(b.name));
  return entries.length ? digest(entries.map(c => `${c.name}=${c.value}`).join(";")) : null;
}
export function signTicket(ticket: RecoveryTicket | FlowTicket, secret: string) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function readTicket(value: string | undefined, secret: string, now = Date.now()) {
  if (!value || value.length > 2048) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const result = ticketSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return result.success && result.data.exp > now && result.data.exp <= now + 3600_000 ? result.data : null;
  } catch { return null; }
}

// An extra per-process abuse guard. Supabase remains the shared, authoritative rate limiter.
// Keys are digests; bounded entries expire. Multi-instance deployments also need edge rate limiting.
export class RecoveryLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  allow(key: string, limit: number, windowMs: number, now = Date.now()) {
    for (const [id, entry] of this.entries) if (entry.until <= now) this.entries.delete(id);
    const id = digest(key);
    const entry = this.entries.get(id);
    if (entry && entry.count >= limit) return false;
    if (entry) entry.count++;
    else {
      if (this.entries.size >= 10_000) return false;
      this.entries.set(id, { count: 1, until: now + windowMs });
    }
    return true;
  }
}
export const recoveryLimiter = new RecoveryLimiter();
