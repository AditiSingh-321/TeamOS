"use client";

import { Bell, ClipboardList, FileText, FolderKanban, GitBranch, Layers3, LayoutGrid, Menu, Search, Settings, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { MemberAvatar } from "@/components/ui/member-avatar";
import type { WorkspaceSummary } from "@/types/team";
import { AccountMenu } from "@/components/auth/account-menu";
import type { AuthProfile } from "@/types/auth";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/workspaces", label: "Workspaces", icon: Users },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/dependencies", label: "Dependencies", icon: GitBranch },
  { href: "/my-tasks", label: "My Tasks", icon: ClipboardList },
];

const upcoming = [
  { label: "AI Assistant", icon: Sparkles },
  { label: "Documents", icon: FileText },
  { label: "Settings", icon: Settings },
];

function Sidebar({ onNavigate, profile, workspaceName }: { onNavigate?: () => void; profile: AuthProfile; workspaceName: string }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-sidebar px-4 py-6 text-white">
      <Link href="/" onClick={onNavigate} className="mx-2 mb-11 flex w-fit items-center gap-3 rounded-md">
        <span className="grid size-9 place-items-center rounded-[10px] bg-violet-600"><Layers3 size={20} aria-hidden="true" /></span>
        <span className="text-xl font-semibold tracking-tight">TeamOS</span>
      </Link>
      <nav aria-label="Main navigation">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a1a0b8]">Workspace</p>
        <ul className="space-y-1">
          {navigation.map(({ href, icon: Icon, label }) => (
            <li key={href}>
              <Link href={href} onClick={onNavigate} aria-current={pathname === href ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-[#c8c6db] transition-colors hover:bg-white/10 hover:text-white", pathname === href && "bg-[#30254e] text-[#e6dcff] hover:bg-[#382a5b]")}>
                <Icon size={17} aria-hidden="true" />{label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a1a0b8]">Tools</p>
        <ul className="space-y-1">
          {upcoming.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[#b6b3cb]">
              <Icon size={17} className="shrink-0" aria-hidden="true" /><span>{label}</span>
              <span className="ml-auto shrink-0 rounded bg-white/8 px-1.5 py-1 text-[9px] leading-none text-[#cac5dd]">Coming Soon</span>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex shrink-0 items-center gap-3 border-t border-white/10 px-2 pt-5">
        <MemberAvatar member={{ ...profile, tone: "violet" }} className="size-9 bg-[#392a60] text-[#e5d9ff]" />
        <div>
          <p className="text-sm font-medium">{profile.name}</p>
          <p className="text-xs text-[#b6b3cb]">{workspaceName}</p>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children, profile, workspace }: { children: ReactNode; profile: AuthProfile; workspace: WorkspaceSummary | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const workspaceName = workspace?.name ?? "Choose workspace";
  const initial = Array.from(workspaceName)[0].toUpperCase();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) dialog.current?.close();
    };

    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="min-h-dvh">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block"><Sidebar profile={profile} workspaceName={workspaceName} /></aside>
      <dialog ref={dialog} aria-label="Navigation menu" className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-72 max-w-[90vw] bg-sidebar backdrop:bg-[#141426]/55 lg:hidden">
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close navigation" className="absolute right-3 top-6 grid size-9 place-items-center rounded-md text-white hover:bg-white/10"><X size={19} aria-hidden="true" /></button>
        <Sidebar profile={profile} workspaceName={workspaceName} onNavigate={() => dialog.current?.close()} />
      </dialog>
      <div className="min-w-0 lg:ml-60">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-white px-4 sm:px-8">
          <button type="button" onClick={() => dialog.current?.showModal()} aria-label="Open navigation" className="grid size-9 place-items-center rounded-md hover:bg-muted lg:hidden"><Menu size={19} aria-hidden="true" /></button>
          <Link href="/workspaces" aria-label={`Workspaces: ${workspaceName}`} className="flex min-w-0 items-center gap-2 rounded-md hover:text-primary">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-violet-100 text-xs font-semibold text-violet-800" aria-hidden="true">{initial}</span>
            <span className="truncate text-sm font-semibold">{workspaceName}</span>
          </Link>
          <div className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground sm:h-auto sm:w-56 sm:justify-start sm:gap-2 sm:border sm:bg-background sm:px-3 sm:py-2 sm:text-xs">
            <Search size={15} aria-hidden="true" /><span className="sr-only sm:not-sr-only">Search workspace</span><span className="sr-only sm:not-sr-only sm:ml-auto sm:text-[10px]">Coming soon</span>
          </div>
          <span role="img" aria-label="Notifications coming soon" title="Notifications coming soon" className="grid size-8 shrink-0 place-items-center text-muted-foreground sm:ml-2"><Bell size={17} aria-hidden="true" /></span>
          <span className="h-6 border-l" aria-hidden="true" />
          <AccountMenu profile={profile} />
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1450px] px-4 py-7 sm:px-8 sm:py-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
