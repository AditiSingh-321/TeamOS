import { redirect } from "next/navigation";
import { getAuthProfile } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";
export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await getAuthProfile()) redirect("/");
  return <AuthShell>{children}</AuthShell>;
}
