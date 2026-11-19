import { Card } from "@/components/ui/card";

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-8 w-48 rounded-lg bg-border/60" />
        <div className="h-4 w-72 max-w-full rounded bg-border/40" />
      </div>
      <div aria-hidden="true" className="grid items-start gap-5 motion-safe:animate-pulse xl:grid-cols-[230px_minmax(0,1fr)]">
        <Card className="space-y-4 p-5"><div className="h-5 w-32 rounded bg-muted" /><div className="h-10 rounded-lg bg-background" /><div className="h-10 rounded-lg bg-background" /></Card>
        <Card className="overflow-hidden"><div className="flex items-center gap-3 border-b p-5"><div className="size-7 rounded-lg bg-violet-soft" /><div className="h-4 w-40 rounded bg-muted" /></div><div className="space-y-4 p-6"><div className="h-5 w-2/3 rounded bg-muted" /><div className="h-4 w-4/5 rounded bg-muted" /><div className="grid gap-3 sm:grid-cols-2">{[0,1,2,3].map(item => <div key={item} className="h-16 rounded-xl border bg-background/70" />)}</div><div className="mt-6 h-20 rounded-xl border bg-background/70" /></div></Card>
      </div>
    </div>
  );
}
