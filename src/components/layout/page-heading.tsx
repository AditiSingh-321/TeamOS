export function PageHeading({ title, description }: { title: string; description: string }) {
  return <div className="space-y-2"><h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2rem]">{title}</h1><p className="max-w-2xl text-[13px] leading-6 text-muted-foreground sm:text-sm">{description}</p></div>;
}
