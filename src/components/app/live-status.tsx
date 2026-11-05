"use client";

import * as React from "react";
import type { Activity } from "@/lib/orb-state";
import { compactTokens, formatElapsed, type LiveStats } from "@/lib/live-stats";
import { describeTool } from "@/lib/tool-cards";
import { cn } from "@/lib/utils";
import { LiquidOrb } from "./liquid-orb";
import { Markdown } from "./markdown";

/** Text that morphs when it changes: the old words blur out while the new ones blur in. */
function MorphText({ text, state }: { text: string; state: string }) {
  const [st, setSt] = React.useState<{ shown: string; leaving: string | null; rev: number }>({ shown: text, leaving: null, rev: 0 });
  // Derived during render (the React way to react to a prop change): the old words stay for the exit animation.
  if (text !== st.shown) setSt({ shown: text, leaving: st.shown, rev: st.rev + 1 });
  React.useEffect(() => {
    if (st.rev === 0) return;
    const t = setTimeout(() => setSt((s) => ({ ...s, leaving: null })), 420);
    return () => clearTimeout(t);
  }, [st.rev]);
  const { shown, leaving, rev } = st;
  return (
    <div className="grid overflow-hidden text-sm font-medium">
      {leaving !== null && (
        <span key={`o${rev}`} data-state={state} className="morph-out orb-text truncate whitespace-nowrap" style={{ gridArea: "1 / 1" }} aria-hidden>
          {leaving}
        </span>
      )}
      <span key={`n${rev}`} data-state={state} className={cn("orb-text truncate whitespace-nowrap", rev > 0 && "morph-in")} style={{ gridArea: "1 / 1" }}>
        {shown}
      </span>
    </div>
  );
}

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
          <MorphText text={step} state={activity.state} />
          {detail && <div className="text-xs text-muted-foreground tabular-nums">{detail}</div>}
        </div>
      </div>
      {stats?.partial && <div className="ml-1 max-w-3xl"><Markdown>{stats.partial}</Markdown></div>}
      {stats?.thinking && activity.state === "thinking" && <p className="line-clamp-3 border-l-2 border-purple/40 pl-3 text-xs text-muted-foreground italic">{stats.thinking}</p>}
    </div>
  );
}
