"use client";

import { ChevronDown, ChevronRight, Bell, ClipboardCheck, CalendarDays, ShieldAlert, ClipboardList, FileText, FolderKanban, GitBranch, Layers3, LayoutGrid, Menu, Search, Settings, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { MemberAvatar } from "@/components/ui/member-avatar";
import type { WorkspaceSummary } from "@/types/team";
import { AccountMenu } from "@/components/auth/account-menu";
import type { AuthProfile } from "@/types/auth";
import { Notifications } from "@/components/collaboration/notifications";
import { LiveSync } from "@/components/collaboration/live-sync";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/workspaces", label: "Workspaces", icon: Users },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/dependencies", label: "Dependencies", icon: GitBranch },
  { href: "/my-tasks", label: "My Tasks", icon: ClipboardList },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/risks", label: "Risk Center", icon: ShieldAlert },
  { href: "/meetings", label: "Meetings", icon: CalendarDays },
  { href: "/approvals", label: "Approval Center", icon: ClipboardCheck },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/security", label: "Settings", icon: Settings },
];

function Sidebar({ onNavigate, profile, workspaceName }: { onNavigate?: () => void; profile: AuthProfile; workspaceName: string }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-sidebar px-4 py-5 text-foreground">
      <Link href="/" onClick={onNavigate} className="mb-6 ml-2 flex w-fit items-center gap-2.5 rounded-lg">
        <span className="brand-mark grid size-9 place-items-center rounded-xl"><Layers3 size={20} aria-hidden="true" /></span>
        <span className="text-[21px] font-semibold tracking-[-0.055em]">TeamOS<span className="text-primary">.</span></span>
      </Link>
      <Link href="/workspaces" onClick={onNavigate} className="mb-5 flex items-center gap-2.5 rounded-xl border bg-card p-2.5 shadow-xs hover:border-primary/30" aria-label={`Switch workspace: ${workspaceName}`}>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-soft text-sm font-semibold text-blue-ink">{Array.from(workspaceName)[0].toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{workspaceName}</span><span className="block text-[11px] text-muted-foreground">Workspace</span></span>
        <ChevronDown size={14} className="text-muted-foreground" aria-hidden="true" />
      </Link>
      <nav aria-label="Main navigation" className="space-y-4">
        {[
          { title: "Workspace", items: navigation.slice(0,5) },
          { title: "Intelligence", items: navigation.slice(5,10) },
          { title: "Updates", items: navigation.slice(10,11) },
          { title: "Account", items: navigation.slice(11) },
        ].map(group=><div key={group.title}><p className="eyebrow mb-2 px-3">{group.title}</p><ul className="space-y-1">{group.items.map(({href,icon:Icon,label})=>{
          const active=href==="/"?pathname==="/":pathname===href||pathname.startsWith(href+"/");
          return <li key={href}><Link href={href} onClick={onNavigate} aria-current={active?"page":undefined} className={cn("relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground",active&&"bg-secondary/75 text-primary hover:bg-secondary hover:text-primary")}><Icon size={17} strokeWidth={active?2:1.7} aria-hidden="true"/>{label}{active&&<span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden="true"/>}</Link></li>;
        })}</ul></div>)}

      </nav>
      <div className="mt-auto pt-6"><div className="flex items-center gap-2.5 border-t px-2 pt-5">
        <MemberAvatar member={{ ...profile, tone: "violet" }} className="size-9 border-2 border-white shadow-xs" />
        <div className="min-w-0"><p className="truncate text-xs font-semibold">{profile.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Your team workspace</p></div>
      </div></div>
    </div>
  );
}

export function AppShell({ children, profile, workspace }: { children: ReactNode; profile: AuthProfile; workspace: WorkspaceSummary | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const workspaceName = workspace?.name ?? "Choose workspace";
  const initial = Array.from(workspaceName)[0].toUpperCase();
  const pathname = usePathname();
  const currentPage = navigation.find(item=>item.href!=="/"&&(pathname===item.href||pathname.startsWith(item.href+"/")))?.label ?? "Overview";

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) dialog.current?.close();
    };

    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="app-background min-h-dvh">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] border-r lg:block"><Sidebar profile={profile} workspaceName={workspaceName}/></aside>
      <dialog ref={dialog} aria-label="Navigation menu" className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-72 max-w-[90vw] bg-sidebar backdrop:bg-foreground/20 backdrop:backdrop-blur-sm lg:hidden">
        <button type="button" onClick={()=>dialog.current?.close()} aria-label="Close navigation" className="absolute right-3 top-7 grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X size={19} aria-hidden="true"/></button>
        <Sidebar profile={profile} workspaceName={workspaceName} onNavigate={()=>dialog.current?.close()}/>
      </dialog>
      <div className="min-w-0 lg:ml-[248px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center gap-3 border-b bg-card/85 px-4 backdrop-blur-md sm:px-7 xl:px-10">
          <button type="button" onClick={()=>dialog.current?.showModal()} aria-label="Open navigation" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"><Menu size={20} aria-hidden="true"/></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex"><span>Workspace</span><ChevronRight size={12} aria-hidden="true"/><span className="font-medium text-foreground">{currentPage}</span></div>
          <Link href="/workspaces" aria-label={`Workspaces: ${workspaceName}`} className="flex min-w-0 items-center gap-2 rounded-lg text-sm font-medium hover:text-primary lg:ml-auto">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-soft text-[11px] font-semibold text-blue-ink" aria-hidden="true">{initial}</span><span className="max-w-32 truncate text-xs sm:max-w-44">{workspaceName}</span><ChevronDown size={12} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true"/>
          </Link>
          <span className="ml-auto lg:ml-1"><Suspense fallback={null}><LiveSync workspaceId={workspace?.id} userId={profile.id}/></Suspense></span>
          <div title="Workspace search is coming soon" className="hidden items-center gap-2 rounded-lg border bg-background/65 px-3 py-2 text-xs text-muted-foreground 2xl:flex"><Search size={14} aria-hidden="true"/><span>Search</span><span className="ml-3 rounded bg-muted px-1.5 py-0.5 text-[10px]">Soon</span></div>
          <Notifications compact/>
          <span className="mx-1 h-6 border-l" aria-hidden="true"/>
          <AccountMenu profile={profile}/>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 sm:py-8 xl:px-10 xl:py-9">{children}</main>
      </div>
    </div>
  );
}
