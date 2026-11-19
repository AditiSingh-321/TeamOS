import { FolderOpen, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon = FolderOpen, title, description, children, compact = false }: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return <div className={cn("empty-state", compact && "sm:flex sm:justify-start sm:gap-4 sm:p-6 sm:text-left")}>
    <span className="empty-icon shrink-0"><Icon size={21} strokeWidth={1.5} aria-hidden="true" /></span>
    <div><p className="text-sm font-medium text-foreground">{title}</p>{description && <p className={cn("mx-auto mt-1.5 max-w-sm text-xs leading-6", compact && "sm:mx-0 sm:max-w-xl")}>{description}</p>}</div>
    {children}
  </div>;
}
