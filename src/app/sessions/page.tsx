"use client";

import * as React from "react";
import { MessagesSquareIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/app/common";
import { SessionRow } from "@/components/app/session-row";
import { useApi, type ProjectListItem, type SessionSummary } from "@/lib/api";

const ALL = "__all";

export default function SessionsPage() {
  const [q, setQ] = React.useState("");
  const [project, setProject] = React.useState(ALL);
  const [filter, setFilter] = React.useState<"all" | "active">("all");
  const deferredQ = React.useDeferredValue(q);
  const params = new URLSearchParams();
  if (deferredQ) params.set("q", deferredQ);
  if (project !== ALL) params.set("project", project);
  if (filter === "active") params.set("active", "1");
  const { data, isLoading } = useApi<{ total: number; sessions: SessionSummary[] }>(`/api/sessions?${params}`, { refreshInterval: 5000, keepPreviousData: true });
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={MessagesSquareIcon} title="Sesiones" description="Todas las conversaciones de Claude Code guardadas en ~/.claude, con su estado en vivo." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Buscar por título, prompt, rama, ruta o id…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
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

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">
          <span>{data ? `${data.total} sesiones` : "Cargando…"}</span>
        </div>
        {isLoading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : data?.sessions.length ? (
          <div className="divide-y">{data.sessions.map((s) => <SessionRow key={s.id} s={s} />)}</div>
        ) : (
          <div className="p-6">
            <EmptyState icon={MessagesSquareIcon} title="No hay sesiones" description="No se encontraron sesiones con estos filtros." />
          </div>
        )}
      </div>
    </div>
  );
}
