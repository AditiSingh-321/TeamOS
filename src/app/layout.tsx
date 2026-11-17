import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dashboard | TeamOS", template: "%s | TeamOS" },
  description: "Track projects, tasks, and team activity in TeamOS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={GeistSans.variable}><AppShell>{children}</AppShell></body></html>;
}
