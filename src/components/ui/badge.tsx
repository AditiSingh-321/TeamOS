import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      violet: "bg-violet-100 text-violet-800",
      green: "bg-emerald-50 text-emerald-800",
      amber: "bg-amber-50 text-amber-800",
      red: "bg-rose-50 text-rose-800",
      blue: "bg-blue-50 text-blue-800",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
