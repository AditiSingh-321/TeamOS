import Link from "next/link";
import { NewPasswordForm } from "@/components/auth/password-forms";
import { Card } from "@/components/ui/card";
import { recoveryAuthorized } from "@/lib/auth/recovery-context";
export const metadata = { title: "Create a new password" };
export default async function Page() {
 const authorized = await recoveryAuthorized();
 return <Card className="p-6 shadow-[var(--shadow-float)] sm:p-8">{authorized ? <><h1 className="text-2xl font-semibold tracking-tight">Create a new password</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a strong password to secure your TeamOS account.</p><NewPasswordForm/></> : <div className="space-y-4"><h1 className="text-2xl font-semibold tracking-tight">Verify your recovery email first</h1><p className="text-sm leading-6 text-muted-foreground">This recovery session is missing or has expired. Use a fresh recovery email to continue.</p><Link href="/forgot-password" className="ui-primary">Request recovery email</Link><Link href="/login" className="block text-sm text-primary hover:underline">Back to Login</Link></div>}</Card>;
}
