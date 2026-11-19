"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export function TaskDrawer({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} aria-labelledby="task-drawer-title" onCancel={(event) => { event.preventDefault(); router.replace(closeHref, { scroll: false }); }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto border-l bg-background text-foreground shadow-2xl backdrop:bg-foreground/20 backdrop:backdrop-blur-sm">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-card/95 px-5 py-5 backdrop-blur-md sm:px-7">
        <h2 id="task-drawer-title" className="min-w-0 break-words text-lg font-semibold">{title}</h2>
        <button type="button" aria-label="Close task drawer" onClick={() => router.replace(closeHref, { scroll: false })} className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-muted">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="space-y-5 p-4 sm:p-6">{children}</div>
    </dialog>
  );
}
