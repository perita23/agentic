"use client";

import * as React from "react";
import type { Activity, OrbState } from "@/lib/orb-state";
import { cn } from "@/lib/utils";

/** How fast the orb's clock runs (rad/s) in each state. The speed eases between states. */
const SPEED: Record<OrbState, number> = { idle: 0.6, thinking: 3.4, writing: 5.2, reading: 1.5, editing: 8, running: 10, searching: 2.2, waiting: 1.1, done: 0.35, error: 4.5 };

/**
 * The liquid ball: its shape, movement, size and colour show what Claude is doing right now.
 * A single clock (--t) drives all motion, so changing state morphs smoothly instead of jumping.
 */
export function LiquidOrb({ state, size = 40, className }: { state: OrbState; size?: number; className?: string }) {
  const id = "g" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = React.useRef<HTMLSpanElement>(null);
  const target = React.useRef(SPEED[state]);
  React.useEffect(() => {
    target.current = SPEED[state];
  }, [state]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    let speed = target.current;
    let t = Math.random() * 20;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      speed += (target.current - speed) * Math.min(1, dt * 2.2);
      t += dt * speed;
      el.style.setProperty("--t", t.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span ref={ref} className={cn("orb", className)} data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <svg width="0" height="0" className="absolute" focusable="false">
        <defs>
          <filter id={id} x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={Math.max(2, size / 10)} result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
          </filter>
        </defs>
      </svg>
      <span className="orb-goo" style={{ filter: `url(#${id})` }}>
        <span className="orb-pose">
          <i className="orb-ball a" />
          <i className="orb-ball b" />
          <i className="orb-ball c" />
          <i className="orb-ball d" />
        </span>
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
