"use client";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { changePassword, sendRecoveryEmail, updateRecoveredPassword, verifyResetCode } from "@/lib/auth/recovery-actions";
import { newPasswordSchema } from "@/lib/auth/password-validation";
import type { PasswordState } from "@/lib/auth/password-service";
import { PasswordField, PasswordStrengthIndicator } from "./password-fields";
import { ResetCodeInput } from "./reset-code-input";
const initial: PasswordState = {};
function Feedback({ state }: { state: PasswordState }) {
  return <>{state.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-soft px-3 py-2.5 text-sm leading-6 text-rose-ink">{state.error}</p>}{state.message && <p role="status" className="rounded-lg border border-green-ink/15 bg-green-soft px-3 py-2.5 text-sm leading-6 text-green-ink">{state.message}</p>}</>;
}
function Submit({ busy, children, disabled }: { busy: boolean; children: React.ReactNode; disabled?: boolean }) {
  return <button type="submit" disabled={busy || disabled} className="ui-primary w-full py-3">{busy && <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true"/>}{busy ? "Please wait…" : children}</button>;
}
function useCooldown(state: PasswordState) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!state.cooldown) return;
    const end = Date.now() + state.cooldown * 1000;
    const update = () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [state]);
  return remaining;
}
export function AuthSuccessState({ change = false }: { change?: boolean }) {
  return <div className="space-y-4 py-3 text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-green-soft text-green-ink"><CheckCircle2 size={24} aria-hidden="true"/></span><h2 className="text-xl font-semibold">{change ? "Password changed successfully" : "Password Updated Successfully"}</h2><p className="text-sm leading-6 text-muted-foreground">{change ? "Your account password has been updated." : "You can now sign in with your new password."}</p><Link className="ui-primary" href={change ? "/" : "/login"}>{change ? "Back to dashboard" : "Back to Login"}</Link></div>;
}
export function ForgotPasswordForm() {
  const [state, submit, pending] = useActionState(sendRecoveryEmail, initial);
  const cooldown = useCooldown(state);
  return <div className="mt-6 space-y-4"><Feedback state={state}/><form action={submit} aria-busy={pending} className="space-y-4"><label className="grid gap-1.5 text-sm font-medium">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending} className="ui-field w-full"/></label><Submit busy={pending} disabled={cooldown > 0}>{cooldown ? `Request again in ${cooldown}s` : "Send Recovery Email"}</Submit></form>{state.sent && <div className="space-y-3 rounded-xl border bg-background/70 p-4"><p className="flex items-center gap-2 text-sm font-medium"><Mail size={16} className="text-primary" aria-hidden="true"/>Check your inbox and spam folder</p><p className="text-xs leading-6 text-muted-foreground">Use the reset link in your email, or enter the verification code if your email includes one. If nothing arrives, wait before retrying or contact your administrator.</p><Link href="/verify-reset-code" className="text-sm font-semibold text-primary hover:underline">Enter verification code →</Link></div>}<Link href="/login" className="block text-center text-sm font-medium text-primary hover:underline">Back to Login</Link></div>;
}
export function VerifyResetCodeForm() {
  const [email, setEmail] = useState("");
  const [state, submit, pending] = useActionState(verifyResetCode, initial);
  const [resendState, resend, resending] = useActionState(sendRecoveryEmail, initial);
  const cooldown = useCooldown(resendState), busy = pending || resending;
  return <div className="mt-6 space-y-4"><Feedback state={state}/><Feedback state={resendState}/><form action={submit} aria-busy={pending}><fieldset disabled={busy} className="space-y-5"><label className="grid gap-1.5 text-sm font-medium">Email address<input name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} maxLength={254} className="ui-field w-full"/></label><ResetCodeInput/><Submit busy={pending}>Verify code</Submit></fieldset></form><form action={resend} aria-busy={resending} className="flex flex-wrap items-center justify-center gap-2 border-t pt-4 text-xs"><input type="hidden" name="email" value={email}/><span className="text-muted-foreground">Didn&apos;t receive the code?</span><button disabled={busy || cooldown > 0 || !email.trim()} className="rounded py-2 font-semibold text-primary hover:underline disabled:opacity-50">{resending ? "Requesting…" : cooldown ? `Resend in ${cooldown}s` : "Resend Code"}</button></form><p className="text-xs leading-5 text-muted-foreground">Supabase enforces code expiry and request limits. Requesting another email may replace your previous code.</p><Link href="/forgot-password" className="block text-center text-sm text-primary hover:underline">Use an email reset link instead</Link></div>;
}
export function NewPasswordForm({ change = false }: { change?: boolean }) {
  const [state, submit, pending] = useActionState(change ? changePassword : updateRecoveredPassword, initial);
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState("");
  if (state.success) return <AuthSuccessState change={change}/>;
  return <div className="mt-6 space-y-4"><Feedback state={{ ...state, error: validationError || state.error }}/><form action={submit} aria-busy={pending} onSubmit={event => {
    const form = new FormData(event.currentTarget);
    const validation = newPasswordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
    if (!validation.success) { event.preventDefault(); setValidationError(validation.error.issues[0].message); }
    else setValidationError("");
  }}><fieldset disabled={pending} className="space-y-4">{change && <PasswordField name="current" label="Current Password" current/>}<PasswordField name="password" label="New Password" onValue={setPassword}/><PasswordStrengthIndicator password={password}/><PasswordField name="confirm" label="Confirm New Password"/>{state.needsNonce && <label className="grid gap-1.5 text-sm font-medium">Security verification code<input name="nonce" autoComplete="one-time-code" inputMode="numeric" maxLength={20} required className="ui-field w-full"/><span className="text-xs font-normal text-muted-foreground">Your session needs an additional email confirmation.</span></label>}<Submit busy={pending}>Update Password</Submit></fieldset></form>{!change && <Link href="/forgot-password" className="block text-center text-xs font-medium text-primary hover:underline">Request a new recovery email</Link>}</div>;
}
