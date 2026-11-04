"use client";

import * as React from "react";
import Link from "next/link";
import { CheckSquareIcon, MessagesSquareIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/app/common";
import { SessionRow } from "@/components/app/session-row";
import { deleteSessions, TrashButton } from "@/components/app/session-trash";
import { Button } from "@/components/ui/button";
import { useApi, type ProjectListItem, type SessionSummary } from "@/lib/api";
import { baseName } from "@/lib/utils";

const ALL = "__all";

export default function SessionsPage() {
  const [q, setQ] = React.useState("");
  const [project, setProject] = React.useState(ALL);
  const [filter, setFilter] = React.useState<"all" | "active">("all");
  const [deep, setDeep] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const deferredQ = React.useDeferredValue(q);
  const params = new URLSearchParams();
  if (deferredQ) params.set("q", deferredQ);
  if (project !== ALL) params.set("project", project);
  if (filter === "active") params.set("active", "1");
  const { data, isLoading } = useApi<{ total: number; sessions: SessionSummary[] }>(deep ? null : `/api/sessions?${params}`, { refreshInterval: 5000, keepPreviousData: true });
  const searchParams = new URLSearchParams({ q: deferredQ });
  if (project !== ALL) searchParams.set("project", project);
  const { data: found, isLoading: searching } = useApi<SearchResult>(deep && deferredQ.trim().length >= 2 ? `/api/search?${searchParams}` : null, { keepPreviousData: true });
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={MessagesSquareIcon}
        title="Sesiones"
        description="Todas las conversaciones de Claude Code guardadas en ~/.claude, con su estado en vivo."
        actions={
          <div className="flex gap-2">
            <Button
              variant={selecting ? "secondary" : "outline"}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((v) => !v);
                setPicked(new Set());
              }}
            >
              <CheckSquareIcon /> {selecting ? "Cancelar" : "Seleccionar"}
            </Button>
            <TrashButton />
          </div>
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={deep ? "Buscar dentro de las conversaciones…" : "Buscar por título, prompt, rama, ruta o id…"}
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los proyectos</SelectItem>
            {projects?.projects.map((p) => (
              <SelectItem key={p.path} value={p.path}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => setDeep(!deep)}
          aria-pressed={deep}
          className={`cursor-pointer rounded-md border px-3 text-sm ${deep ? "border-primary/60 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          En el contenido
        </button>
        <div className="flex rounded-md border p-0.5">
          {(["all", "active"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`cursor-pointer rounded px-3 text-sm ${filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "Todas" : "Activas"}
            </button>
          ))}
        </div>
      </div>

      {deep ? (
        <SearchResults q={deferredQ} result={found} loading={searching} />
      ) : (
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">
          <span>{data ? `${data.total} sesiones` : "Cargando…"}</span>
          {selecting && (
            <span className="flex items-center gap-2">
              <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => setPicked(new Set((data?.sessions ?? []).filter((x) => !x.active).map((x) => x.id)))}>
                Seleccionar todas
              </button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!picked.size}
                onClick={async () => {
                  if (!confirm(`¿Mover ${picked.size} sesión${picked.size === 1 ? "" : "es"} a la papelera? Podrás recuperar${picked.size === 1 ? "la" : "las"} durante 30 días.`)) return;
                  await deleteSessions([...picked]);
                  setPicked(new Set());
                  setSelecting(false);
                }}
              >
                <Trash2Icon /> Borrar{picked.size ? ` (${picked.size})` : ""}
              </Button>
            </span>
          )}
        </div>
        {isLoading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : data?.sessions.length ? (
          <div className="divide-y">{data.sessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                onDelete={(x) => void deleteSessions([x.id])}
                select={selecting ? { checked: picked.has(s.id), onToggle: () => setPicked((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else if (!s.active) n.add(s.id); return n; }) } : undefined}
              />
            ))}</div>
        ) : (
          <div className="p-6">
            <EmptyState icon={MessagesSquareIcon} title="No hay sesiones" description="No se encontraron sesiones con estos filtros." />
          </div>
        )}
      </div>
      )}
    </div>
  );
}

interface SearchResult {
  hits: { sessionId: string; title: string; cwd: string | null; role: "user" | "assistant"; snippet: string; timestamp: string | null }[];
  partial: boolean;
  scanned: number;
}

/** Highlight every case-insensitive occurrence of `q` (rendered as text, never HTML). */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, i)) {
    parts.push(text.slice(i, at), <mark key={at} className="rounded-sm bg-warning/25 px-0.5 text-foreground">{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

function SearchResults({ q, result, loading }: { q: string; result?: SearchResult; loading: boolean }) {
  if (q.trim().length < 2) return <p className="text-sm text-muted-foreground">Escribe al menos 2 caracteres para buscar dentro de tus conversaciones.</p>;
  if (!result && loading) return <Skeleton className="h-40" />;
  if (!result?.hits.length) return <EmptyState icon={SearchIcon} title="Sin coincidencias" description={`Nada encontrado para «${q}».`} />;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">
        {result.hits.length} coincidencias en {result.scanned} sesiones{result.partial && " · búsqueda parcial (límite de tiempo), afina la consulta"}
      </div>
      <div className="divide-y">
        {result.hits.map((h, i) => (
          <Link key={`${h.sessionId}-${i}`} href={`/sessions/${h.sessionId}`} className="block px-4 py-2.5 hover:bg-accent/60">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate font-medium text-foreground">{h.title}</span>
              <span className="shrink-0">· {h.role === "user" ? "Tú" : "Claude"}</span>
              <span className="ml-auto shrink-0 font-mono">{baseName(h.cwd)}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              <Highlight text={h.snippet} q={q} />
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
