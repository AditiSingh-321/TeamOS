import "server-only";
import { cookies } from "next/headers";
import { createAuthClient } from "@/lib/supabase/server";
import { establishRecovery, requestAddress } from "./recovery-context";
import { FLOW_COOKIE, readTicket, recoveryLimiter, recoverySecret, verifierDigest } from "./recovery-security";
import { verifyRecovery } from "./password-service";

export async function handleRecoveryLink(request: Request) {
  const params = new URL(request.url).searchParams;
  const secret = recoverySecret();
  const jar = await cookies();
  const flow = secret ? readTicket(jar.get(FLOW_COOKIE)?.value, secret) : null;
  const validFlow = flow?.purpose === "request" && flow.verifier === verifierDigest(jar.getAll()) ? flow : null;
  let location = "/forgot-password?error=recovery";
  if (secret && recoveryLimiter.allow(`link:${await requestAddress()}`, 12, 15 * 60_000)) {
    const client = await createAuthClient(true);
    const hash = params.get("token_hash"), code = params.get("code");
    if (client && ((hash && params.get("type") === "recovery") || (code && validFlow))) {
      const result = await verifyRecovery(client.auth, hash ? { token_hash: hash } : { code: code!, flow: validFlow, flowId: params.get("sb_flow_id") ?? undefined });
      if (result.identity) { await establishRecovery(result.identity); location = "/reset-password"; }
      else if (result.error?.startsWith("You are already")) location = "/forgot-password?error=signed-in";
    }
  }
  jar.delete(FLOW_COOKIE);
  // Deliberately ignore next/redirect_to: credentials never travel to arbitrary destinations.
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
