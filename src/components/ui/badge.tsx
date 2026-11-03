import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 transition-colors",
  {
    variants: {
      variant: {
        default: "border-border text-muted-foreground",
        blue: "border-primary/40 bg-primary/10 text-link",
        green: "border-success/40 bg-success/10 text-success",
        yellow: "border-warning/40 bg-warning/10 text-warning",
        red: "border-destructive/40 bg-destructive/10 text-destructive",
        purple: "border-purple/40 bg-purple/10 text-purple",
        solid: "border-transparent bg-secondary text-secondary-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
