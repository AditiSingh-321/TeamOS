import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newPasswordSchema, recoveryEmailSchema, resetCodeSchema } from "./password-validation";
import { emailDigest, type FlowTicket, type RecoveryTicket } from "./recovery-security";

export type PasswordState = { error?: string; message?: string; sent?: boolean; success?: boolean; needsNonce?: boolean; cooldown?: number };
export type AuthApi = SupabaseClient["auth"];
export const RECOVERY_MESSAGE = "If an account exists with this email, you'll receive password reset instructions.";
export const INVALID_RECOVERY = "This recovery code or link is invalid, expired, or already used. Request a new email and try again.";

export async function requestRecovery(auth: AuthApi, email: string, redirectTo: string): Promise<PasswordState> {
  if (!recoveryEmailSchema.safeParse(email).success) return { error: "Enter a valid email address." };
  try { await auth.resetPasswordForEmail(email, { redirectTo }); } catch { /* Same public response for provider and transport failures. */ }
  return { message: RECOVERY_MESSAGE, sent: true, cooldown: 60 };
}
export async function authenticatedIdentity(auth: AuthApi) {
  try {
    const { data: { user }, error } = await auth.getUser();
    if (error || !user) return null;
    const claims = await auth.getClaims();
    const sid = claims.data?.claims.session_id;
    if (claims.error || typeof sid !== "string" || claims.data?.claims.sub !== user.id || !user.updated_at) return null;
    return { uid: user.id, sid, version: user.updated_at, email: user.email ?? "" };
  } catch { return null; }
}
export async function verifyRecovery(auth: AuthApi, input: { email: string; token: string } | { token_hash: string } | { code: string; flow?: FlowTicket | null; flowId?: string }) {
  // Never replace a different account's existing browser session during recovery.
  let existing;
  try { existing = await auth.getUser(); } catch { return { error: "Recovery verification is temporarily unavailable. Try again." }; }
  if (existing.error && existing.error.name !== "AuthSessionMissingError") return { error: "Recovery verification is temporarily unavailable. Try again." };
  if (existing.data.user) return { error: "You are already signed in. Sign out before starting password recovery, or use Account Security." };
  try {
    if ("email" in input) {
      const email = recoveryEmailSchema.safeParse(input.email), token = resetCodeSchema.safeParse(input.token);
      if (!email.success || !token.success) return { error: "Enter a valid email address and all six recovery digits." };
      const result = await auth.verifyOtp({ email: email.data, token: token.data, type: "recovery" });
      if (result.error || !result.data.session || !result.data.user) return { error: INVALID_RECOVERY };
    } else if ("token_hash" in input) {
      if (!/^[a-zA-Z0-9_-]{20,512}$/.test(input.token_hash)) return { error: INVALID_RECOVERY };
      const result = await auth.verifyOtp({ token_hash: input.token_hash, type: "recovery" });
      if (result.error || !result.data.session || !result.data.user) return { error: INVALID_RECOVERY };
    } else {
      if (!input.flow || input.flow.purpose !== "request" || input.flow.exp <= Date.now()) return { error: INVALID_RECOVERY };
      const result = await auth.exchangeCodeForSession(input.code, input.flowId ? { flowId: input.flowId } : undefined);
      if (result.error || (!("redirectType" in result.data) || result.data.redirectType !== "recovery") || !result.data.user || !result.data.session || emailDigest(result.data.user.email ?? "") !== input.flow.email) return { error: INVALID_RECOVERY };
    }
    const identity = await authenticatedIdentity(auth);
    return identity ? { identity } : { error: INVALID_RECOVERY };
  } catch { return { error: INVALID_RECOVERY }; }
}
export async function hasRecovery(auth: AuthApi, ticket: RecoveryTicket | null) {
  if (!ticket || ticket.purpose !== "recovery" || ticket.exp <= Date.now()) return false;
  const identity = await authenticatedIdentity(auth);
  return !!identity && identity.uid === ticket.uid && identity.sid === ticket.sid && identity.version === ticket.version;
}
function updateError(code?: string) {
  if (code === "weak_password") return "This password does not meet the account's password policy. Try a longer, less common password.";
  if (code === "same_password") return "Choose a password different from your current password.";
  if (code === "reauthentication_not_valid") return "The security code is invalid or expired. Sign in again and retry.";
  return "Password could not be updated. Check your session and try again.";
}
export async function resetRecoveredPassword(auth: AuthApi, ticket: RecoveryTicket | null, input: { password: string; confirm: string }): Promise<PasswordState> {
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!await hasRecovery(auth, ticket)) return { error: "Your recovery authorization has expired. Request a new recovery email." };
  try {
    const { error } = await auth.updateUser({ password: parsed.data.password });
    if (error) return { error: updateError(error.code) };
    // The changed user.updated_at also invalidates the old signed authorization.
    try { await auth.signOut({ scope: "local" }); } catch { /* Adapter clears browser cookies as well. */ }
    return { success: true };
  } catch { return { error: "Password could not be updated. Please try again." }; }
}
export async function changeAuthenticatedPassword(auth: AuthApi, verifier: AuthApi, input: { current: string; password: string; confirm: string; nonce?: string }): Promise<PasswordState> {
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (input.nonce && !/^\d{6,10}$/.test(input.nonce)) return { needsNonce: true, error: "Enter the security code from your email." };
  if (!input.current || input.current.length > 256) return { error: "Enter your current password." };
  try {
    const user = await auth.getUser();
    if (user.error || !user.data.user?.email) return { error: "Sign in again before changing your password." };
    // Separate, non-persisting client: current password is verified even when the provider's
    // optional current-password enforcement is disabled. It cannot replace browser cookies.
    const proof = await verifier.signInWithPassword({ email: user.data.user.email, password: input.current });
    if (proof.error || proof.data.user?.id !== user.data.user.id || !proof.data.session) return { error: "Current password could not be verified. Check it or use password recovery." };
    const result = await auth.updateUser({ password: parsed.data.password, current_password: input.current, ...(input.nonce ? { nonce: input.nonce } : {}) });
    if (result.error?.code === "reauthentication_needed") {
      const challenge = await auth.reauthenticate();
      return challenge.error ? { error: "Sign in again to complete this secure password change." } : { needsNonce: true, error: "Enter the security code just emailed to you, then submit again." };
    }
    return result.error ? { error: updateError(result.error.code), needsNonce: !!input.nonce } : { success: true };
  } catch { return { error: "Password change is temporarily unavailable. Try again." }; }
  finally { try { await verifier.signOut({ scope: "local" }); } catch { /* Non-persisting verification session only. */ } }
}
