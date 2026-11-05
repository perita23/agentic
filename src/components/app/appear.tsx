"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Wraps something that shows up while the user is watching: it fades in instead of popping. Empty output takes no space. */
export function Appear({ live = true, className, children }: { live?: boolean; className?: string; children: React.ReactNode }) {
  // Decided once, when the item first shows up.
  const [on] = React.useState(() => live && pastBoot());
  return <div className={cn("empty:hidden", on && "appear", className)}>{children}</div>;
}

const BOOT = Date.now();
/** False during the first moments of a page, so opening a long history does not animate every item at once. */
export const pastBoot = () => Date.now() - BOOT > 2500;
