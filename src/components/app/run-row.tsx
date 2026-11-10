"use client";

import * as React from "react";
import Link from "next/link";
import { CheckIcon, PencilIcon, TerminalSquareIcon, XIcon, ZapIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, refresh, type Run } from "@/lib/api";
import { runTitle } from "@/lib/threads";
import { baseName, cn, timeAgo } from "@/lib/utils";
import { errorMessage, StatusDot } from "./common";

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "en curso",
  completed: "completada",
  failed: "fallida",
  stopped: "detenida",
  interrupted: "interrumpida",
};
export const RUN_STATUS_VARIANT = { running: "yellow", completed: "green", failed: "red", stopped: "default", interrupted: "default" } as const;

/** Renames a run. An empty name goes back to showing the prompt. */
export async function renameRun(id: string, title: string) {
  try {
    await api("PATCH", `/api/runs/${id}`, { title });
    await refresh("/api/runs");
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

/** The name field of a run: Enter saves, Escape cancels. */
export function RunNameInput({ run, onDone, className }: { run: Pick<Run, "id" | "title" | "prompt" | "mode">; onDone: () => void; className?: string }) {
  const [value, setValue] = React.useState(run.title ?? runTitle(run));
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    const ok = await renameRun(run.id, value);
    setBusy(false);
    if (ok) onDone();
  }
  return (
    <form
      className={cn("flex min-w-0 flex-1 items-center gap-1", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input autoFocus value={value} maxLength={120} aria-label="Nombre de la ejecución" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} onFocus={(e) => e.currentTarget.select()} className="h-8" />
      <button type="submit" disabled={busy} aria-label="Guardar nombre" className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border hover:bg-accent">
        <CheckIcon className="size-4" />
      </button>
      <button type="button" aria-label="Cancelar" onClick={onDone} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border hover:bg-accent">
        <XIcon className="size-4" />
      </button>
    </form>
  );
}

export function RunRow({ r }: { r: Run }) {
  const Icon = r.mode === "tmux" ? TerminalSquareIcon : ZapIcon;
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="group relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60">
      <StatusDot status={r.status} />
      {editing ? (
        <RunNameInput run={r} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Link href={`/runs/${r.id}`} className="absolute inset-0" aria-label={runTitle(r)} />
          <div className="pointer-events-none min-w-0 flex-1">
            <div className="truncate text-sm font-medium group-hover:text-link">{runTitle(r)}</div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Icon className="size-3" /> {r.mode}
              </span>
              <span className="truncate font-mono">{baseName(r.projectPath)}</span>
              {r.agent && <span className="hidden sm:inline">@{r.agent}</span>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Renombrar"
            title="Renombrar"
            onClick={() => setEditing(true)}
            className="relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100"
          >
            <PencilIcon className="size-3.5" />
          </button>
          <div className="pointer-events-none flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
            <Badge variant={RUN_STATUS_VARIANT[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
            <span>{timeAgo(r.lastOpenedAt && r.lastOpenedAt > r.startedAt ? r.lastOpenedAt : r.startedAt)}</span>
          </div>
        </>
      )}
    </div>
  );
}
