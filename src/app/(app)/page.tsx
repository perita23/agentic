"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ActivityIcon, ArrowRightIcon, CircleDollarSignIcon, KanbanSquareIcon, LayoutDashboardIcon, MessagesSquareIcon, RocketIcon, TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, Stat, StatusDot } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { RunRow } from "@/components/app/run-row";
import { SessionRow } from "@/components/app/session-row";
import { useApi, type Overview } from "@/lib/api";
import { baseName, shortPath } from "@/lib/utils";
import { useDeviceName } from "@/lib/use-device";

const COLUMNS = [
  { key: "backlog", label: "Backlog", color: "bg-muted-foreground" },
  { key: "todo", label: "To do", color: "bg-primary" },
  { key: "in_progress", label: "En curso", color: "bg-warning" },
  { key: "review", label: "Revisión", color: "bg-purple" },
  { key: "done", label: "Hecho", color: "bg-success" },
];

export default function DashboardPage() {
  const { data, error } = useApi<Overview>("/api/overview", { refreshInterval: 5000 });
  const device = useDeviceName();
  const launcher = useLauncher();
  const c = data?.counts;
  const totalTasks = c?.tasks || 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={LayoutDashboardIcon}
        title="Dashboard"
        description={`Visión general de tu actividad con Claude Code en ${device}.`}
      />
      {error && <p className="text-sm text-destructive">Error cargando datos: {error.message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Sesiones activas", value: c?.activeSessions, hint: `${c?.sessions ?? 0} en total · ${c?.sessionsToday ?? 0} hoy`, icon: ActivityIcon, accent: "text-success" },
          { label: "Ejecuciones en curso", value: c?.runningRuns, hint: "lanzadas desde Agentic", icon: TerminalSquareIcon, accent: "text-warning" },
          { label: "Tareas abiertas", value: c?.openTasks, hint: `${c?.tasks ?? 0} tareas en total`, icon: KanbanSquareIcon, accent: "text-primary" },
          { label: "Coste acumulado", value: c ? `$${c.costUsd.toFixed(2)}` : undefined, hint: `${c?.projects ?? 0} proyectos`, icon: CircleDollarSignIcon, accent: "text-purple" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Stat label={s.label} value={s.value ?? <Skeleton className="h-7 w-12" />} hint={s.hint} icon={s.icon} accent={s.accent} />
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="size-4 text-success" /> Procesos de Claude Code en vivo
            </CardTitle>
            <span className="text-xs text-muted-foreground">se actualiza cada 5 s</span>
          </CardHeader>
          <CardContent className="px-0">
            {!data ? (
              <div className="space-y-2 px-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : data.activeProcesses.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hay ninguna sesión de Claude Code abierta ahora mismo.</p>
            ) : (
              <div className="scroll-area divide-y border-y">
                {data.activeProcesses.map((p) => (
                  <Link key={p.pid} href={p.sessionId ? `/sessions/${p.sessionId}` : "/sessions"} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/60">
                    <StatusDot status={p.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name || baseName(p.cwd)}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{shortPath(p.cwd)}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{p.status === "busy" ? "trabajando" : p.status === "idle" ? "esperando" : p.status}</div>
                      <div>
                        pid {p.pid} · {p.entrypoint ?? p.kind}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KanbanSquareIcon className="size-4 text-primary" /> Tareas
            </CardTitle>
            <Link href="/tasks" className="flex items-center gap-1 text-xs text-link hover:underline">
              Abrir tablero <ArrowRightIcon className="size-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
              {COLUMNS.map((col) => {
                const n = data?.tasksByStatus[col.key] ?? 0;
                return totalTasks ? <motion.div key={col.key} className={col.color} initial={{ width: 0 }} animate={{ width: `${(n / totalTasks) * 100}%` }} /> : null;
              })}
            </div>
            <ul className="space-y-1.5 text-sm">
              {COLUMNS.map((col) => (
                <li key={col.key} className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${col.color}`} />
                  <span className="text-muted-foreground">{col.label}</span>
                  <span className="ml-auto tabular-nums">{data?.tasksByStatus[col.key] ?? 0}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessagesSquareIcon className="size-4" /> Sesiones recientes
            </CardTitle>
            <Link href="/sessions" className="flex items-center gap-1 text-xs text-link hover:underline">
              Ver todas <ArrowRightIcon className="size-3" />
            </Link>
          </CardHeader>
          <CardContent className="px-0">
            {data && data.recentSessions.length === 0 ? (
              <div className="px-4">
                <EmptyState icon={MessagesSquareIcon} title="Sin sesiones todavía" description={`Cuando uses Claude Code en ${device} aparecerán aquí.`} />
              </div>
            ) : (
              <div className="scroll-area divide-y border-y">{data?.recentSessions.map((s) => <SessionRow key={s.id} s={s} />)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalSquareIcon className="size-4" /> Últimas ejecuciones
            </CardTitle>
            <Link href="/runs" className="flex items-center gap-1 text-xs text-link hover:underline">
              Ver todas <ArrowRightIcon className="size-3" />
            </Link>
          </CardHeader>
          <CardContent className="px-0">
            {data && data.recentRuns.length === 0 ? (
              <div className="px-4">
                <EmptyState
                  icon={RocketIcon}
                  title="Aún no has lanzado nada"
                  description="Lanza una sesión headless o interactiva en cualquiera de tus proyectos."
                  action={
                    <Button size="sm" onClick={() => launcher.open()}>
                      <RocketIcon /> Nueva sesión
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="scroll-area divide-y border-y">{data?.recentRuns.map((r) => <RunRow key={r.id} r={r} />)}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
