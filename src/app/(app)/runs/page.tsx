"use client";

import * as React from "react";
import { RocketIcon, TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { RunRow } from "@/components/app/run-row";
import { UsageCard } from "@/components/app/usage-card";
import { useApi, type Run } from "@/lib/api";

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "running", label: "En curso" },
  { key: "completed", label: "Completadas" },
  { key: "failed", label: "Fallidas" },
] as const;

export default function RunsPage() {
  const { data } = useApi<{ runs: Run[] }>("/api/runs", { refreshInterval: 3000 });
  const launcher = useLauncher();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["key"]>("all");
  const runs = (data?.runs ?? []).filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={TerminalSquareIcon}
        title="Ejecuciones"
        description="Sesiones de Claude Code lanzadas desde Agentic (headless o interactivas en tmux)."
        actions={
          <Button onClick={() => launcher.open()}>
            <RocketIcon /> Nueva sesión
          </Button>
        }
      />
      <UsageCard />
      <div className="flex w-fit rounded-md border p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`cursor-pointer rounded px-3 py-1 text-sm ${filter === f.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{(data?.runs ?? []).filter((r) => f.key === "all" || r.status === f.key).length}</span>
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {!data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : runs.length ? (
          <div className="divide-y">{runs.map((r) => <RunRow key={r.id} r={r} />)}</div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={RocketIcon}
              title="No hay ejecuciones"
              description="Lanza Claude Code sobre un proyecto, una tarea del tablero o continúa una sesión existente."
              action={
                <Button size="sm" onClick={() => launcher.open()}>
                  <RocketIcon /> Nueva sesión
                </Button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
