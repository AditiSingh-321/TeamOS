import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { Card } from "@/components/ui/card";
import { googleCallbackUrl, supabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const callbackError = error === "confirmation"
    ? "This confirmation link is invalid or has expired. Sign in if you've already confirmed your email."
    : error === "oauth" ? "Google sign-in couldn't be completed. Try again." : undefined;

  return (
    <Card className="p-6 shadow-[var(--shadow-float)] sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to TeamOS</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Access your team dashboard.</p>
      <AuthForm mode="login" configured={Boolean(supabaseConfig())} googleEnabled={Boolean(googleCallbackUrl())} callbackError={callbackError} />
      <p className="mt-5 text-sm text-muted-foreground">
        New to TeamOS? <Link href="/signup" className="rounded font-semibold text-primary hover:underline">Create an account</Link>
      </p>
    </Card>
  );
}
