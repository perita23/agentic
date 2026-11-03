"use client";

import * as React from "react";
import { ChevronRightIcon, FileDiffIcon, FilePlus2Icon, GitCommitHorizontalIcon, InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState } from "./common";

interface RunDiff {
  available: boolean;
  reason?: string;
  baseline?: { head: string; branch: string | null; untrackedUnknown?: boolean };
  commits: { hash: string; subject: string }[];
  files: { file: string; status: string; additions: number | null; deletions: number | null; preExisting: boolean }[];
  newFiles: { file: string; content: string | null }[];
  patch: string;
  truncated: boolean;
}

const STATUS: Record<string, { label: string; variant: "green" | "yellow" | "red" | "purple" | "default" }> = {
  A: { label: "añadido", variant: "green" },
  M: { label: "modificado", variant: "yellow" },
  D: { label: "borrado", variant: "red" },
  R: { label: "renombrado", variant: "purple" },
  C: { label: "copiado", variant: "purple" },
  T: { label: "tipo", variant: "default" },
};

/** Split a unified patch into per-file chunks keyed by the b/ path. */
function splitPatch(patch: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of patch.split("\n")) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      current = [];
      out.set(m[2], current);
      continue;
    }
    current?.push(line);
  }
  return out;
}

export function PatchLines({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-x-auto bg-inset font-mono text-[12px] leading-5">
      {lines.map((l, i) => {
        if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(l)) return null;
        const cls = l.startsWith("@@")
          ? "bg-primary/10 text-link"
          : l.startsWith("+")
            ? "bg-success/10 text-success"
            : l.startsWith("-")
              ? "bg-destructive/10 text-destructive"
              : "text-muted-foreground";
        return (
          <div key={i} className={cn("px-3 whitespace-pre", cls)}>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function FileBlock({ title, badge, stats, children, defaultOpen }: { title: string; badge?: React.ReactNode; stats?: React.ReactNode; children: React.ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/60">
        <ChevronRightIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{title}</span>
        {badge}
        {stats}
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  );
}

export function RunDiffView({ runId, live }: { runId: string; live: boolean }) {
  const { data, error } = useApi<RunDiff>(`/api/runs/${runId}/diff`, { refreshInterval: live ? 4000 : 0 });
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return <Skeleton className="h-48" />;
  if (!data.available) return <EmptyState icon={InfoIcon} title="Diff no disponible" description={data.reason} />;
  if (!data.files.length && !data.newFiles.length && !data.commits.length)
    return <EmptyState icon={FileDiffIcon} title="Sin cambios" description="Esta ejecución no ha modificado ningún fichero del repositorio." />;

  const chunks = splitPatch(data.patch);
  const totals = data.files.reduce((a, f) => ({ add: a.add + (f.additions ?? 0), del: a.del + (f.deletions ?? 0) }), { add: 0, del: 0 });
  // New untracked files count as all-additions.
  for (const f of data.newFiles) if (f.content) totals.add += f.content.replace(/\n$/, "").split("\n").length;
  const many = data.files.length + data.newFiles.length > 8;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {data.files.length + data.newFiles.length} ficheros · <span className="text-success">+{totals.add}</span> <span className="text-destructive">−{totals.del}</span>
        </span>
        {data.baseline && (
          <span className="font-mono text-xs text-muted-foreground">
            desde {data.baseline.head.slice(0, 7)}
            {data.baseline.branch ? ` (${data.baseline.branch})` : ""}
          </span>
        )}
      </div>
      {data.commits.length > 0 && (
        <div className="rounded-lg border bg-card">
          {data.commits.map((c) => (
            <div key={c.hash} className="flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0">
              <GitCommitHorizontalIcon className="size-4 text-muted-foreground" />
              <span className="font-mono text-xs text-link">{c.hash}</span>
              <span className="truncate">{c.subject}</span>
            </div>
          ))}
        </div>
      )}
      {data.files.some((f) => f.preExisting) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="size-3.5" /> Los ficheros marcados como «previo» ya tenían cambios sin commitear antes de la ejecución.
        </p>
      )}
      {data.files.map((f) => (
        <FileBlock
          key={f.file}
          title={f.file}
          defaultOpen={!many}
          badge={
            <>
              {f.preExisting && <Badge>previo</Badge>}
              <Badge variant={STATUS[f.status[0]]?.variant ?? "default"}>{STATUS[f.status[0]]?.label ?? f.status}</Badge>
            </>
          }
          stats={
            f.additions === null ? (
              <span className="text-xs text-muted-foreground">binario</span>
            ) : (
              <span className="font-mono text-xs tabular-nums">
                <span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
              </span>
            )
          }
        >
          {chunks.get(f.file) ? <PatchLines lines={chunks.get(f.file)!} /> : <p className="px-3 py-2 text-xs text-muted-foreground">Sin vista previa.</p>}
        </FileBlock>
      ))}
      {data.newFiles.map((f) => (
        <FileBlock key={f.file} title={f.file} defaultOpen={!many} badge={<Badge variant="green">nuevo</Badge>} stats={<FilePlus2Icon className="size-4 text-success" />}>
          {f.content !== null ? (
            <PatchLines lines={f.content.replace(/\n$/, "").split("\n").map((l) => `+${l}`)} />
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">Fichero binario o demasiado grande para previsualizar.</p>
          )}
        </FileBlock>
      ))}
      {data.baseline?.untrackedUnknown && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="size-3.5" /> El repositorio tenía demasiados ficheros sin seguimiento para distinguir los nuevos; sólo se muestran cambios en ficheros versionados.
        </p>
      )}
      {data.truncated && <p className="text-xs text-warning">El diff es muy grande y se ha truncado a 512 KB.</p>}
    </div>
  );
}
