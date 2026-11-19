import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { NewPasswordForm } from "@/components/auth/password-forms";
import { Card } from "@/components/ui/card";
import { PageHeading } from "@/components/layout/page-heading";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
export const metadata = { title: "Account Security", robots: { index: false, follow: false } };
export default async function Page() {
 const profile = await requireAuth();
 const client = await createAuthClient();
 const result = await client?.auth.getUser();
 const emailIdentity = result?.data.user?.identities?.some(identity => identity.provider === "email");
 return <div className="space-y-6"><PageHeading title="Settings" description="Account → Security"/><Card className="max-w-xl p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-violet-soft text-primary"><ShieldCheck size={20} aria-hidden="true"/></span><div><h2 className="panel-heading">Change Password</h2><p className="mt-1 break-all text-xs text-muted-foreground">{profile.email}</p></div></div><p className="mt-4 text-sm leading-6 text-muted-foreground">Confirm your current password to securely update your account.</p>{!emailIdentity && <p className="mt-4 rounded-xl border bg-blue-soft p-3 text-xs leading-6 text-blue-ink">You signed up with a provider such as Google. If you have never set a password, use <Link href="/forgot-password" className="font-semibold underline">email recovery</Link> first, then sign out before opening its link. If you already set one, enter it below. Google sign-in remains available.</p>}<NewPasswordForm change/></Card></div>;
}
