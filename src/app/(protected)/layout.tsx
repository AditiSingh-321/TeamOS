import { AppShell } from "@/components/layout/app-shell";
import { requireAuth } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/workspaces/queries";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [profile, { active }] = await Promise.all([requireAuth(), getWorkspaceContext()]);
  return <AppShell profile={profile} workspace={active}>{children}</AppShell>;
}
