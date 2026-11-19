import { Layers3 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
export function AuthShell({ children }: { children: ReactNode }) {
  return <main className="app-background relative isolate grid min-h-dvh place-items-center overflow-hidden px-4 py-10"><div className="w-full min-w-0 max-w-md"><Link href="/login" className="mx-auto mb-7 flex w-fit items-center gap-3 rounded-md"><span className="brand-mark grid size-10 place-items-center rounded-xl"><Layers3 size={20} aria-hidden="true" /></span><span className="text-2xl font-semibold tracking-[-0.055em]">TeamOS</span></Link>{children}</div></main>;
}
