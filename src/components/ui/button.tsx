import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background shadow-xs hover:bg-foreground/85",
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive: "bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive hover:text-white",
        outline: "border bg-secondary/60 shadow-xs hover:bg-secondary hover:border-border-strong",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5 has-[>svg]:px-2.5",
        sm: "h-7 rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
