import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function RecoveryLayout({ children }: { children: React.ReactNode }) { return <AuthShell>{children}</AuthShell>; }
