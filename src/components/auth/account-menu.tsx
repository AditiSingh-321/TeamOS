"use client";

import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { useActionState } from "react";
import { logout } from "@/lib/auth/actions";
import type { AuthProfile } from "@/types/auth";
import { MemberAvatar } from "@/components/ui/member-avatar";

export function AccountMenu({ profile }: { profile: AuthProfile }) {
  const [state, submit, pending] = useActionState(logout, {});

  return (
    <details className="relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-1 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={`Account for ${profile.name}`}>
        <MemberAvatar member={{ ...profile, tone: "violet" }} />
        <span className="hidden max-w-28 truncate pr-1 text-xs font-medium 2xl:block">{profile.name}</span>
      </summary>
      <div className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-2 shadow-[var(--shadow-float)]">
        <div className="px-2 py-2">
          <p className="break-words text-sm font-semibold">{profile.name}</p>
          {profile.email && <p className="break-words text-xs text-muted-foreground">{profile.email}</p>}
        </div>
        <Link href="/settings/security" className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"><ShieldCheck size={15} aria-hidden="true"/>Account Security</Link>
        <form action={submit} className="border-t pt-1" aria-busy={pending}>
          <button type="submit" disabled={pending} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium enabled:hover:bg-muted disabled:opacity-60">
            <LogOut size={15} aria-hidden="true" />{pending ? "Signing out…" : "Sign out"}
          </button>
          {state.error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{state.error}</p>}
        </form>
      </div>
    </details>
  );
}
