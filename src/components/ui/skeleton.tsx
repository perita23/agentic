import { cn } from "@/lib/utils";

/** A placeholder; the light sweep over it is in globals.css (`[data-slot="skeleton"]`). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("rounded-md", className)} {...props} />;
}

export { Skeleton };
