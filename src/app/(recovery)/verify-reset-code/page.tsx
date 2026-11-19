import { VerifyResetCodeForm } from "@/components/auth/password-forms";
import { Card } from "@/components/ui/card";
export const metadata = { title: "Verify your email" };
export default function Page() {
 return <Card className="p-6 shadow-[var(--shadow-float)] sm:p-8"><h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter the 6-digit verification code sent to your email.</p><VerifyResetCodeForm/></Card>;
}
