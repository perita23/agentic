"use client";

import Link from "next/link";
import { GitBranchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/lib/api";
import { baseName, formatBytes, timeAgo } from "@/lib/utils";
import { StatusDot } from "./common";

export function SessionRow({ s }: { s: SessionSummary }) {
  return (
    <Link href={`/sessions/${s.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60">
      <StatusDot status={s.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium group-hover:text-link">{s.title}</span>
          {s.active && (
            <Badge variant={s.status === "busy" ? "yellow" : "green"} className="shrink-0">
              {s.status === "busy" ? "trabajando" : "activa"}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="truncate font-mono">{baseName(s.cwd)}</span>
          {s.gitBranch && (
            <span className="hidden items-center gap-1 sm:flex">
              <GitBranchIcon className="size-3" /> {s.gitBranch}
            </span>
          )}
          {s.model && <span className="hidden lg:inline">{s.model}</span>}
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
        <div>{timeAgo(s.lastActivity)}</div>
        <div className="tabular-nums opacity-70">{formatBytes(s.sizeBytes)}</div>
      </div>
    </Link>
  );
}
