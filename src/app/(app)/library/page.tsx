"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLinkIcon, FileTextIcon, GitPullRequestIcon, LibraryIcon, SearchIcon, SparklesIcon, TicketIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CopyButton, EmptyState, PageHeader } from "@/components/app/common";
import { useApi } from "@/lib/api";
import { KIND_LABEL, type LibraryItem, type LibraryKind } from "@/lib/library";
import { baseName, cn, timeAgo } from "@/lib/utils";

const ICON = { artifact: SparklesIcon, pr: GitPullRequestIcon, issue: TicketIcon, doc: FileTextIcon } as const;
const TONE = { artifact: "text-purple", pr: "text-success", issue: "text-link", doc: "text-orange" } as const;
const KINDS = Object.keys(KIND_LABEL) as LibraryKind[];

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export default function LibraryPage() {
  const { data, error } = useApi<{ items: LibraryItem[]; scanned: number; total: number }>("/api/library", { refreshInterval: (d) => (d && d.scanned < d.total ? 3000 : 0), keepPreviousData: true });
  const [kind, setKind] = React.useState<LibraryKind | "all">("all");
  const [q, setQ] = React.useState("");
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const counts = React.useMemo(() => Object.fromEntries(KINDS.map((k) => [k, items.filter((i) => i.kind === k).length])) as Record<LibraryKind, number>, [items]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (kind === "all" || i.kind === kind) && (!needle || `${i.title} ${i.url} ${i.cwd ?? ""}`.toLowerCase().includes(needle)));
  const indexing = !!data && data.scanned < data.total;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={LibraryIcon} title="Biblioteca" description="Los artifacts, PRs, incidencias y documentos que han salido en tus sesiones de Claude Code, a un clic y con su contexto." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex w-fit flex-wrap rounded-md border p-0.5" role="group" aria-label="Tipo">
          {(["all", ...KINDS] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn("cursor-pointer rounded px-3 py-1 text-sm", kind === k ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {k === "all" ? "Todo" : KIND_LABEL[k]}
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{k === "all" ? items.length : counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar en la biblioteca" placeholder="Buscar por título, enlace o proyecto…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      </div>

      {indexing && (
        <p className="text-xs text-muted-foreground" role="status">
          Indexando tus sesiones… {data!.scanned} de {data!.total}. Las más recientes primero; esto sólo pasa la primera vez.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!data && !error && <Skeleton className="h-48" />}
      {data && !shown.length && !indexing && (
        <EmptyState icon={LibraryIcon} title={items.length ? "Sin resultados" : "Aún no hay nada en la biblioteca"} description={items.length ? "Prueba con otra búsqueda o tipo." : "Cuando Claude cree un artifact o hable de una PR o incidencia en una sesión, aparecerá aquí."} />
      )}

      <div className="grid gap-2">
        {shown.slice(0, 300).map((i) => {
          const Icon = ICON[i.kind];
          return (
            <div key={i.url} className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-inset">
                <Icon className={cn("size-4", TONE[i.kind])} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{i.title || shortUrl(i.url)}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="truncate font-mono">{shortUrl(i.url)}</span>
                  {i.cwd && <span>{baseName(i.cwd)}</span>}
                  <span>{timeAgo(i.at)}</span>
                  {i.mentions > 1 && <span>{i.mentions} menciones</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild size="sm" variant="outline">
                  <a href={i.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon /> Abrir
                  </a>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/sessions/${i.sessionId}`}>Ver sesión</Link>
                </Button>
                <CopyButton value={i.url} label="Copiar enlace" />
              </div>
            </div>
          );
        })}
      </div>
      {shown.length > 300 && <p className="text-xs text-muted-foreground">Mostrando los 300 más recientes: afina la búsqueda para ver el resto.</p>}
    </div>
  );
}
