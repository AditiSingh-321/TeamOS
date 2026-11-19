"use client";

import { useActionState, type ReactNode } from "react";
import type { WorkspaceActionState } from "@/types/team";
import { cn } from "@/lib/utils";

export function WorkspaceForm({ action, label, children, compact = false, danger = false }: {
  action: (state: WorkspaceActionState, form: FormData) => Promise<WorkspaceActionState>;
  label: string;
  children?: ReactNode;
  compact?: boolean;
  danger?: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});

  return (
    <form action={submit} aria-busy={pending} className="space-y-2">
      <fieldset disabled={pending} className={cn("min-w-0 gap-3", compact ? "flex flex-wrap items-center" : "grid")}>
        {children}
        <button type="submit" className={cn("ui-primary disabled:opacity-60",
          danger ? "bg-destructive enabled:hover:bg-destructive/90" : "bg-primary enabled:hover:bg-primary/90")}>
          {pending ? "Working…" : label}
        </button>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}
