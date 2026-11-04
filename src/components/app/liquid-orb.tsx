"use client";

import * as React from "react";
import type { Activity, OrbState } from "@/lib/orb-state";
import { cn } from "@/lib/utils";

/** The liquid ball: its colour, speed and wobble show what Claude is doing right now. */
export function LiquidOrb({ state, size = 40, className }: { state: OrbState; size?: number; className?: string }) {
  const id = "g" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <span className={cn("orb", className)} data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <svg width="0" height="0" className="absolute" focusable="false">
        <defs>
          <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={Math.max(2, size / 10)} result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
          </filter>
        </defs>
      </svg>
      <span className="orb-goo" style={{ filter: `url(#${id})` }}>
        <i className="orb-ball a" />
        <i className="orb-ball b" />
        <i className="orb-ball c" />
        <i className="orb-ball d" />
      </span>
    </span>
  );
}

/** Orb + the state as text (so the state is never conveyed by animation alone). */
export function ActivityOrb({ activity, size = 40, className }: { activity: Activity; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} role="status" aria-live="polite">
      <LiquidOrb state={activity.state} size={size} />
      <span className="text-sm text-muted-foreground">{activity.label}</span>
    </span>
  );
}
