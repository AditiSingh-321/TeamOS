import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { Card } from "@/components/ui/card";
import { googleCallbackUrl, supabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <AuthForm mode="signup" configured={Boolean(supabaseConfig())} googleEnabled={Boolean(googleCallbackUrl())} />
      <p className="mt-5 text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="rounded font-semibold text-primary hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}
