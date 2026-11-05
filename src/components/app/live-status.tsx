"use client";

import * as React from "react";
import type { Activity } from "@/lib/orb-state";
import { compactTokens, formatElapsed, type LiveStats } from "@/lib/live-stats";
import { describeTool } from "@/lib/tool-cards";
import { cn } from "@/lib/utils";
import { LiquidOrb } from "./liquid-orb";

/** Placeholder lines for the answer that is still being written, in the orb's colours. */
export function ResponseSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-2.5", className)} role="presentation" aria-hidden>
      <div className="orb-skeleton w-[92%]" />
      <div className="orb-skeleton w-[78%]" style={{ animationDelay: "-0.5s" }} />
      <div className="orb-skeleton w-[55%]" style={{ animationDelay: "-1s" }} />
    </div>
  );
}

/**
 * What Claude is doing right now: the orb, the step in plain words (the command or file it is on), how long the
 * turn has taken and how many tokens it has written, a glimpse of its reasoning, and the skeleton of the answer.
 */
export function LiveStatus({ activity, stats, startedAt, size = 44 }: { activity: Activity; stats?: LiveStats | null; startedAt?: string | null; size?: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const tool = stats?.tool ? describeTool(stats.tool.name, stats.tool.input) : null;
  const step = tool ? `${tool.group}${tool.title ? ` · ${tool.title}` : ""}` : activity.label;
  const elapsed = startedAt ? formatElapsed(now - Date.parse(startedAt)) : null;
  const detail = [elapsed, stats && stats.outputTokens > 0 ? `${compactTokens(stats.outputTokens)} tokens` : null, stats && stats.contextTokens > 0 ? `contexto ${compactTokens(stats.contextTokens)}` : null].filter(Boolean).join(" · ");
  const writing = activity.state === "thinking" || activity.state === "writing";
  return (
    <div className="grid gap-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <LiquidOrb state={activity.state} size={size} />
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{step}</div>
          {detail && <div className="text-xs text-muted-foreground tabular-nums">{detail}</div>}
        </div>
      </div>
      {stats?.thinking && activity.state === "thinking" && <p className="line-clamp-3 border-l-2 border-purple/40 pl-3 text-xs text-muted-foreground italic">{stats.thinking}</p>}
      {writing && <ResponseSkeleton className="ml-1 max-w-xl" />}
    </div>
  );
}
