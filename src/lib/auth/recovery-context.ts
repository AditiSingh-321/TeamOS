import "server-only";
import { cookies, headers } from "next/headers";
import { createAuthClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { hasRecovery, type AuthApi } from "./password-service";
import { FLOW_COOKIE, RECOVERY_COOKIE, RECOVERY_SECONDS, readTicket, recoverySecret, signTicket, type RecoveryTicket } from "./recovery-security";

export const recoveryCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
export async function recoveryTicket() {
  const secret = recoverySecret();
  const ticket = secret ? readTicket((await cookies()).get(RECOVERY_COOKIE)?.value, secret) : null;
  return ticket?.purpose === "recovery" ? ticket : null;
}
export async function recoveryAuthorized(auth?: AuthApi) {
  const client = auth ?? (await createAuthClient())?.auth;
  return client ? hasRecovery(client, await recoveryTicket()) : false;
}
export async function establishRecovery(identity: { uid: string; sid: string; version: string }) {
  const secret = recoverySecret();
  if (!secret) throw new Error("Recovery configuration unavailable");
  const ticket: RecoveryTicket = { purpose: "recovery", uid: identity.uid, sid: identity.sid, version: identity.version, exp: Date.now() + RECOVERY_SECONDS * 1000 };
  (await cookies()).set(RECOVERY_COOKIE, signTicket(ticket, secret), { ...recoveryCookieOptions, maxAge: RECOVERY_SECONDS });
}
export async function clearRecoveryCookies(clearSession = false) {
  const jar = await cookies();
  jar.delete(RECOVERY_COOKIE); jar.delete(FLOW_COOKIE);
  if (clearSession) {
    const config = supabaseConfig();
    const base = config ? `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token` : null;
    for (const cookie of jar.getAll()) if (base && (cookie.name === base || cookie.name.startsWith(base + ".") || cookie.name.startsWith(base + "-code-verifier"))) jar.delete(cookie.name);
  }
}
export async function requestAddress() {
  // Production ingress must overwrite these headers; provider rate limits are always retained.
  const incoming = await headers();
  return incoming.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 100) || "local";
}
