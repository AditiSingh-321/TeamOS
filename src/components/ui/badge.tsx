import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium leading-tight", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      violet: "bg-violet-soft text-violet-ink",
      green: "bg-green-soft text-green-ink",
      amber: "bg-amber-soft text-amber-ink",
      red: "bg-rose-soft text-rose-ink",
      blue: "bg-blue-soft text-blue-ink",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
