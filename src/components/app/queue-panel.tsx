"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ListOrderedIcon, PlayIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi, type ProjectListItem } from "@/lib/api";
import { baseName } from "@/lib/utils";
import { errorMessage, StatusDot } from "./common";
import { PRIORITIES } from "./task-dialog";

interface QueueInfo {
  running: boolean;
  config: { projectPath?: string | null; limit: number } | null;
  processed: { taskId: string; runId: string; status: string }[];
  currentRunId: string | null;
  stopReason: string | null;
  finishedAt: string | null;
  pending: { id: string; title: string; priority: string; projectPath: string }[];
}

const ALL = "__all";

function QueueDialog({ onClose, defaultProject }: { onClose: () => void; defaultProject?: string }) {
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [project, setProject] = React.useState(defaultProject ?? ALL);
  const [permissionMode, setPermissionMode] = React.useState("acceptEdits");
  const [limit, setLimit] = React.useState("5");
  const [budget, setBudget] = React.useState("");
  const [stopOnFailure, setStopOnFailure] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const { data: preview } = useApi<QueueInfo>(`/api/queue${project !== ALL ? `?project=${encodeURIComponent(project)}` : ""}`);
  const n = Math.min(Number(limit) || 0, preview?.pending.length ?? 0);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("POST", "/api/queue/start", {
        projectPath: project === ALL ? null : project,
        permissionMode,
        limit: Number(limit),
        maxBudgetUsd: budget ? Number(budget) : undefined,
        stopOnFailure,
      });
      toast.success("Cola en marcha");
      refresh("/api/queue", "/api/tasks", "/api/runs", "/api/overview");
      onClose();
    } catch (err) {
      toast.error("No se pudo iniciar la cola", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={start} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListOrderedIcon className="size-4" /> Ejecutar cola de tareas
            </DialogTitle>
            <DialogDescription>Claude ejecutará las tareas «To do» una a una, por prioridad. Las que terminen bien pasan a Revisión.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Proyecto</Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger>
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
            </div>
            <div className="grid gap-1.5">
              <Label>Permisos</Label>
              <Select value={permissionMode} onValueChange={setPermissionMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">Plan (sólo planifica)</SelectItem>
                  <SelectItem value="default">Por defecto (deniega lo sensible)</SelectItem>
                  <SelectItem value="acceptEdits">Aceptar ediciones</SelectItem>
                  <SelectItem value="auto">Auto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="q-limit">Máx. tareas en esta tanda</Label>
              <Input id="q-limit" type="number" min={1} max={50} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="q-budget">Presupuesto por tarea (USD)</Label>
              <Input id="q-budget" type="number" min={0} step="0.5" placeholder="sin límite" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Parar en el primer fallo
            <Switch checked={stopOnFailure} onCheckedChange={setStopOnFailure} />
          </label>
          <div className="rounded-lg border">
            <div className="border-b px-3 py-2 text-xs text-muted-foreground">
              Se ejecutarán {n} de {preview?.pending.length ?? "…"} tareas pendientes
            </div>
            <ol className="max-h-48 overflow-y-auto text-sm">
              {preview?.pending.slice(0, Number(limit) || 0).map((t, i) => {
                const prio = PRIORITIES.find((p) => p.key === t.priority);
                return (
                  <li key={t.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-0">
                    <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className={`text-[10px] ${prio?.className ?? ""}`}>●</span>
                    <span className="flex-1 truncate">{t.title}</span>
                    <span className="font-mono text-xs text-muted-foreground">{baseName(t.projectPath)}</span>
                  </li>
                );
              })}
              {preview && !preview.pending.length && <li className="px-3 py-3 text-xs text-muted-foreground">No hay tareas «To do» con proyecto asignado.</li>}
            </ol>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !n}>
              <PlayIcon /> Iniciar cola
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Header button + live banner for the task queue. */
export function useQueue(defaultProject?: string) {
  const { data } = useApi<QueueInfo>("/api/queue", { refreshInterval: (d) => (d?.running ? 2000 : 10_000) });
  const [open, setOpen] = React.useState(false);
  // undefined until the first response: only batches that finish after the page
  // loaded are announced, even when they finish before a poll sees them running.
  const lastFinished = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (!data) return;
    if (lastFinished.current !== undefined && !data.running && data.finishedAt && data.finishedAt !== lastFinished.current) {
      toast.info("Cola finalizada", { description: data.stopReason ?? undefined });
    }
    if (!data.running) lastFinished.current = data.finishedAt ?? null;
    else if (lastFinished.current === undefined) lastFinished.current = null;
  }, [data]);

  async function stop() {
    try {
      await api("POST", "/api/queue/stop");
      refresh("/api/queue");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const button = (
    <Button variant="outline" onClick={() => setOpen(true)} disabled={data?.running}>
      <ListOrderedIcon /> Ejecutar cola
    </Button>
  );

  const banner = (
    <AnimatePresence>
      {data?.running && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm">
            <StatusDot status="running" />
            <span className="font-medium">Cola en marcha</span>
            <span className="text-muted-foreground tabular-nums">
              {data.processed.length}/{data.config?.limit ?? "?"} tareas
            </span>
            {data.currentRunId && (
              <Link href={`/runs/${data.currentRunId}`} className="text-link hover:underline">
                Ver ejecución actual
              </Link>
            )}
            <Button size="sm" variant="destructive" className="ml-auto" onClick={stop}>
              <SquareIcon /> Parar tras la actual
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const dialog = open ? <QueueDialog defaultProject={defaultProject} onClose={() => setOpen(false)} /> : null;
  return { button, banner, dialog };
}
