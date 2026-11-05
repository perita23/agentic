"use client";

import Link from "next/link";
import { TerminalSquareIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Run } from "@/lib/api";
import { baseName, timeAgo } from "@/lib/utils";
import { StatusDot } from "./common";

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "en curso",
  completed: "completada",
  failed: "fallida",
  stopped: "detenida",
  interrupted: "interrumpida",
};
export const RUN_STATUS_VARIANT = { running: "yellow", completed: "green", failed: "red", stopped: "default", interrupted: "default" } as const;

export function RunRow({ r }: { r: Run }) {
  const Icon = r.mode === "tmux" ? TerminalSquareIcon : ZapIcon;
  return (
    <Link href={`/runs/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60">
      <StatusDot status={r.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium group-hover:text-link">{r.prompt.split("\n")[0] || (r.mode === "tmux" ? "Sesión interactiva" : "(sin prompt)")}</div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Icon className="size-3" /> {r.mode}
          </span>
          <span className="truncate font-mono">{baseName(r.projectPath)}</span>
          {r.agent && <span className="hidden sm:inline">@{r.agent}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
        <Badge variant={RUN_STATUS_VARIANT[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
        <span>{timeAgo(r.startedAt)}</span>
      </div>
    </Link>
  );
}
