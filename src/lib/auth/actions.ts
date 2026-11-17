"use server";

import { redirect } from "next/navigation";
import { googleCallbackUrl } from "@/lib/supabase/config";
import { createAuthClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/types/auth";

const unavailable = "Authentication is unavailable. Check the TeamOS Supabase configuration.";

function credentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 256) return null;
  return { email, password };
}

export async function login(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = credentials(formData);
  if (!input) return { error: "Enter a valid email address and password." };

  const supabase = await createAuthClient(true);
  if (!supabase) return { error: unavailable };

  const { error } = await supabase.auth.signInWithPassword(input);
  if (error?.code === "email_not_confirmed") return { error: "Confirm your email address using the link in your inbox, then try again." };
  if (error?.code === "invalid_credentials") return { error: "The email address or password is incorrect." };
  if (error?.status === 429) return { error: "Too many attempts. Wait a moment and try again." };
  if (error) return { error: "Sign-in is temporarily unavailable. Try again." };

  redirect("/");
}

export async function signup(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = credentials(formData);
  const fullName = String(formData.get("name") ?? "").trim();

  if (!fullName || fullName.length > 100) return { error: "Enter a name between 1 and 100 characters." };
  if (!input || input.password.length < 8) return { error: "Enter a valid email address and a password of at least 8 characters." };

  const supabase = await createAuthClient(true);
  if (!supabase) return { error: unavailable };

  const { data, error } = await supabase.auth.signUp({
    ...input,
    options: { data: { full_name: fullName } },
  });

  if (error?.code === "weak_password") return { error: "Use a stronger password. Try a longer password with mixed character types." };
  if (error?.status === 429) return { error: "Too many attempts. Wait a moment and try again." };
  if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
    return { error: "We couldn't create your account. Try again." };
  }
  if (data.session) redirect("/");

  return { message: "If this address can be registered, you'll receive an email with a confirmation link. Check your inbox or sign in if you already have an account." };
}

export async function signInWithGoogle(): Promise<AuthFormState> {
  const redirectTo = googleCallbackUrl();
  const supabase = await createAuthClient(true);
  if (!redirectTo || !supabase) return { error: "Google sign-in is unavailable." };

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) return { error: "Couldn't start Google sign-in. Try again." };
  redirect(data.url);
}

export async function logout(): Promise<AuthFormState> {
  const supabase = await createAuthClient(true);
  if (!supabase) redirect("/login");

  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { error: "Couldn't sign out. Try again." };

  redirect("/login");
}
