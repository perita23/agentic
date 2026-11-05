"use client";

import * as React from "react";
import type { Activity } from "@/lib/orb-state";
import { compactTokens, formatElapsed, type LiveStats } from "@/lib/live-stats";
import { describeTool } from "@/lib/tool-cards";
import { LiquidOrb } from "./liquid-orb";

/**
 * What Claude is doing right now: the orb, the step in plain words (the command or file it is on), how long the
 * turn has taken and how many tokens it has written, a glimpse of its reasoning.
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
  return (
    <div className="grid gap-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <LiquidOrb state={activity.state} size={size} />
        <div className="min-w-0">
          <div data-state={activity.state} className="orb-text truncate text-sm font-medium">{step}</div>
          {detail && <div className="text-xs text-muted-foreground tabular-nums">{detail}</div>}
        </div>
      </div>
      {stats?.thinking && activity.state === "thinking" && <p className="line-clamp-3 border-l-2 border-purple/40 pl-3 text-xs text-muted-foreground italic">{stats.thinking}</p>}
    </div>
  );
}
