import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/password-forms";
import { Card } from "@/components/ui/card";
export const metadata = { title: "Forgot your password?" };
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
 const params = await searchParams;
 return <Card className="p-6 shadow-[var(--shadow-float)] sm:p-8"><h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your email address and we’ll send you instructions to reset your password.</p>{params.error === "recovery" && <p role="alert" className="mt-4 rounded-lg bg-rose-soft p-3 text-sm text-rose-ink">This recovery link is invalid, expired, already used, or opened in a different browser. Request another email below or use its verification code.</p>}{params.error === "signed-in" && <p role="alert" className="mt-4 rounded-lg bg-amber-soft p-3 text-sm text-amber-ink">You are already signed in. Sign out before recovering an account, or open <Link href="/settings/security" className="font-semibold underline">Account Security</Link>.</p>}<ForgotPasswordForm/></Card>;
}
