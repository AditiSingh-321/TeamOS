"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient, createPasswordVerifier } from "@/lib/supabase/server";
import { recoveryCallbackUrl } from "@/lib/supabase/config";
import { clearRecoveryCookies, establishRecovery, recoveryCookieOptions, recoveryTicket, requestAddress } from "./recovery-context";
import { FLOW_COOKIE, emailDigest, recoveryLimiter, recoverySecret, signTicket, verifierDigest } from "./recovery-security";
import { changeAuthenticatedPassword, RECOVERY_MESSAGE, requestRecovery, resetRecoveredPassword, verifyRecovery, type PasswordState } from "./password-service";
import { recoveryEmailSchema } from "./password-validation";

const unavailable = "Password recovery is not configured. Contact your TeamOS administrator.";
export async function sendRecoveryEmail(_state: PasswordState, form: FormData): Promise<PasswordState> {
  const parsed = recoveryEmailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const secret = recoverySecret(), callback = recoveryCallbackUrl();
  const client = await createAuthClient(true);
  if (!secret || !callback || !client) return { error: unavailable };
  const address = await requestAddress();
  if (!recoveryLimiter.allow(`send-ip:${address}`, 6, 15 * 60_000)) return { error: "Too many recovery requests. Wait 15 minutes before trying again.", cooldown: 900 };
  if (!recoveryLimiter.allow(`send-email:${emailDigest(parsed.data)}`, 1, 60_000)) return { sent: true, message: RECOVERY_MESSAGE, cooldown: 60 };
  const result = await requestRecovery(client.auth, parsed.data, callback);
  const jar = await cookies();
  const verifier = verifierDigest(jar.getAll());
  if (verifier) jar.set(FLOW_COOKIE, signTicket({ purpose: "request", email: emailDigest(parsed.data), verifier, exp: Date.now() + 3600_000 }, secret), { ...recoveryCookieOptions, maxAge: 3600 });
  return result;
}
export async function verifyResetCode(_state: PasswordState, form: FormData): Promise<PasswordState> {
  if (!recoverySecret()) return { error: unavailable };
  if (!recoveryLimiter.allow(`verify:${await requestAddress()}`, 12, 15 * 60_000)) return { error: "Too many verification attempts. Wait 15 minutes, then request a new code." };
  const client = await createAuthClient(true);
  if (!client) return { error: unavailable };
  const result = await verifyRecovery(client.auth, { email: String(form.get("email") ?? ""), token: String(form.get("token") ?? "") });
  if (!result.identity) return { error: result.error };
  await establishRecovery(result.identity);
  redirect("/reset-password");
}
export async function updateRecoveredPassword(_state: PasswordState, form: FormData): Promise<PasswordState> {
  const client = await createAuthClient(true);
  if (!client) return { error: unavailable };
  const result = await resetRecoveredPassword(client.auth, await recoveryTicket(), { password: String(form.get("password") ?? ""), confirm: String(form.get("confirm") ?? "") });
  if (result.success) { await clearRecoveryCookies(true); redirect("/reset-password/complete"); }
  return result;
}
export async function changePassword(_state: PasswordState, form: FormData): Promise<PasswordState> {
  const client = await createAuthClient(true), verifier = createPasswordVerifier();
  if (!client || !verifier) return { error: "Authentication is unavailable. Try again later." };
  if (await recoveryTicket()) return { error: "Finish password recovery or sign in again before using account settings." };
  return changeAuthenticatedPassword(client.auth, verifier.auth, { current: String(form.get("current") ?? ""), password: String(form.get("password") ?? ""), confirm: String(form.get("confirm") ?? ""), nonce: String(form.get("nonce") ?? "") });
}
