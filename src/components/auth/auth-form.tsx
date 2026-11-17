"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { login, signInWithGoogle, signup } from "@/lib/auth/actions";
import type { AuthFormState } from "@/types/auth";

const fieldStyle = "w-full rounded-md border bg-card px-3 py-2.5 text-sm";
const buttonStyle = "flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const initialState: AuthFormState = {};

export function AuthForm({ mode, googleEnabled, configured, callbackError }: {
  mode: "login" | "signup";
  googleEnabled: boolean;
  configured: boolean;
  callbackError?: string;
}) {
  const isSignup = mode === "signup";
  const [state, submit, pending] = useActionState(isSignup ? signup : login, initialState);
  const [googleState, submitGoogle, googlePending] = useActionState(signInWithGoogle, initialState);
  const error = state.error ?? googleState.error ?? (!configured ? "Authentication is unavailable until Supabase is configured." : callbackError);
  const busy = pending || googlePending;

  return (
    <div className="mt-6 space-y-4">
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>}
      {state.message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">{state.message}</p>}
      <form action={submit} aria-busy={pending}>
        <fieldset disabled={!configured || busy} className="space-y-4">
          {isSignup && (
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-medium">Full name</label>
              <input id="name" name="name" autoComplete="name" maxLength={100} required className={fieldStyle} />
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required className={fieldStyle} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium">Password</label>
            <input id="password" name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : undefined} maxLength={256} aria-describedby={isSignup ? "password-hint" : undefined} required className={fieldStyle} />
            {isSignup && <p id="password-hint" className="text-xs text-muted-foreground">Use at least 8 characters.</p>}
          </div>
          <button type="submit" className={`${buttonStyle} bg-primary text-primary-foreground enabled:hover:bg-primary/90`}>
            {pending && <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
            {pending ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? "Create account" : "Sign in")}
          </button>
        </fieldset>
      </form>
      {googleEnabled && (
        <form action={submitGoogle} aria-busy={googlePending}>
          <button type="submit" disabled={busy} className={`${buttonStyle} border bg-card enabled:hover:bg-muted`}>
            {googlePending ? "Connecting to Google…" : "Continue with Google"}
          </button>
        </form>
      )}
    </div>
  );
}
