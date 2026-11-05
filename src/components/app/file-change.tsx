"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, FilePenLineIcon, FilePlusIcon, FileXIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { lineDiff, parsePatch, type DiffLine } from "@/lib/line-diff";
import type { FileChange } from "@/lib/server/run-changes";
import { cn } from "@/lib/utils";
import type { ToolResult } from "./tool-card";

const rel = (p: string, root: string) => {
  const base = root.replace(/\/+$/, "") + "/";
  return p.startsWith(base) ? p.slice(base.length) : p;
};

/** Keep only the changed lines and a little context around them. */
function trim(lines: DiffLine[], ctx = 2): (DiffLine | null)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.t !== " " || l.s.startsWith("@@")) for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep[k] = true;
  });
  const out: (DiffLine | null)[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (keep[i]) {
      out.push(l);
      gap = false;
    } else if (!gap && out.length) {
      out.push(null); // "…" separator
      gap = true;
    }
  });
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

function Diff({ lines, truncated }: { lines: (DiffLine | null)[]; truncated?: boolean }) {
  return (
    <div className="max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
      {lines.map((l, i) =>
        l === null ? (
          <div key={i} className="px-3 text-muted-foreground/60 select-none">⋯</div>
        ) : l.s.startsWith("@@") && l.t === " " ? (
          <div key={i} className="bg-secondary/40 px-3 text-muted-foreground">{l.s}</div>
        ) : (
          <div key={i} className={cn("flex min-w-max px-3 whitespace-pre", l.t === "+" && "bg-success/10 text-success", l.t === "-" && "bg-destructive/10 text-destructive", l.t === " " && "text-muted-foreground")}>
            <span className="mr-2 w-3 shrink-0 select-none">{l.t === " " ? "" : l.t}</span>
            <span>{l.s || " "}</span>
          </div>
        ),
      )}
      {truncated && <div className="px-3 py-1 text-muted-foreground">… el cambio continúa (la pestaña «Cambios» lo tiene completo).</div>}
    </div>
  );
}

function Counts({ add, del }: { add: number | null; del: number | null }) {
  if (add == null && del == null) return null;
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-[11px] tabular-nums">
      {add ? <span className="text-success">+{add}</span> : null}
      {del ? <span className="text-destructive">−{del}</span> : null}
    </span>
  );
}

type Action = "created" | "edited" | "deleted";
const ACTION = {
  created: { label: "Creó", icon: FilePlusIcon, tone: "bg-success/15 text-success" },
  edited: { label: "Editó", icon: FilePenLineIcon, tone: "bg-warning/15 text-warning" },
  deleted: { label: "Borró", icon: FileXIcon, tone: "bg-destructive/15 text-destructive" },
} as const;

function Frame({ action, path, add, del, status, children, defaultOpen = true }: { action: Action; path: string; add: number | null; del: number | null; status?: "running" | "error" | "ok"; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const a = ACTION[action];
  return (
    <div className={cn("ml-6 overflow-hidden rounded-lg border bg-inset text-xs", status === "error" && "border-destructive/40")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left hover:bg-accent/40">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", a.tone)}>
          <a.icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">{a.label} archivo</span>
          <span className="block truncate font-mono text-[13px] font-medium text-foreground" title={path}>{path}</span>
        </span>
        <Counts add={add} del={del} />
        {status === "running" ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-warning" aria-label="En curso" /> : status === "error" ? <XIcon className="size-3.5 shrink-0 text-destructive" aria-label="Error" /> : status === "ok" ? <CheckIcon className="size-3.5 shrink-0 text-success" aria-label="Hecho" /> : null}
        <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  );
}

/** An Edit / Write / MultiEdit call, shown where it happened: file, lines added and removed, and the code. */
export function EditCard({ name, input, result, finished, projectPath }: { name: string; input: unknown; result?: ToolResult; finished: boolean; projectPath: string }) {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const path = rel(typeof i.file_path === "string" ? i.file_path : "", projectPath);
  const hunks: { old: string; next: string }[] =
    name === "Write"
      ? [{ old: "", next: typeof i.content === "string" ? i.content : "" }]
      : name === "MultiEdit" && Array.isArray(i.edits)
        ? (i.edits as Record<string, unknown>[]).map((e) => ({ old: String(e.old_string ?? ""), next: String(e.new_string ?? "") }))
        : [{ old: String(i.old_string ?? ""), next: String(i.new_string ?? "") }];
  const parts = hunks.map((h) => lineDiff(h.old, h.next));
  const add = parts.reduce((n, p) => n + p.add, 0);
  const del = parts.reduce((n, p) => n + p.del, 0);
  const lines: (DiffLine | null)[] = parts.flatMap((p, k) => [...(k ? [null] : []), ...(name === "Write" ? p.lines : trim(p.lines))]);
  const status = result?.isError ? "error" : result ? "ok" : finished ? undefined : "running";
  return (
    <Frame action={name === "Write" ? "created" : "edited"} path={path} add={add} del={del} status={status} defaultOpen={lines.length <= 80}>
      <Diff lines={lines.slice(0, 200)} truncated={lines.length > 200} />
    </Frame>
  );
}

/** A change detected in the working tree after a command (sed, python, tee…), with its diff. */
export function FileChangeCard({ change }: { change: FileChange }) {
  const lines = trim(parsePatch(change.patch));
  return (
    <Frame action={change.status} path={change.path} add={change.add} del={change.del} defaultOpen={lines.length <= 80}>
      {lines.length ? <Diff lines={lines} truncated={change.truncated} /> : <div className="px-3 py-2 text-muted-foreground">Sin vista previa (archivo binario o muy grande).</div>}
    </Frame>
  );
}
