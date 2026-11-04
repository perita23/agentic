"use client";

import * as React from "react";
import Link from "next/link";
import { AlarmClockIcon, FolderIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { api, refresh, useApi, type ProjectListItem } from "@/lib/api";
import { describeWhen, untilText, type ScheduleWhen } from "@/lib/schedule-format";
import { baseName, cn, timeAgo } from "@/lib/utils";

interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  projectPath: string;
  prompt: string;
  when: ScheduleWhen;
  permissionMode: string;
  model?: string;
  maxBudgetUsd?: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
}

const KEY = "/api/schedules";
const DAYS = [
  { d: 1, l: "L" },
  { d: 2, l: "M" },
  { d: 3, l: "X" },
  { d: 4, l: "J" },
  { d: 5, l: "V" },
  { d: 6, l: "S" },
  { d: 0, l: "D" },
];
const MODES = [
  { v: "default", l: "Preguntar (en segundo plano se deniega lo sensible)" },
  { v: "plan", l: "Sólo planificar" },
  { v: "acceptEdits", l: "Aceptar ediciones" },
  { v: "auto", l: "Auto" },
];

/** Recurring jobs people actually want from an agent. */
const PRESETS: { label: string; name: string; prompt: string; when: ScheduleWhen; permissionMode: string }[] = [
  {
    label: "Resumen diario",
    name: "Resumen de ayer",
    prompt: "Resume en español los commits de las últimas 24 horas de este repositorio: qué cambió, posibles riesgos y qué quedó a medias. No modifiques nada.",
    when: { kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] },
    permissionMode: "plan",
  },
  {
    label: "Tests nocturnos",
    name: "Tests nocturnos",
    prompt: "Ejecuta la suite de tests y el linter. Si algo falla, explica la causa probable y propone el arreglo, sin aplicarlo.",
    when: { kind: "daily", time: "02:00", days: [0, 1, 2, 3, 4, 5, 6] },
    permissionMode: "default",
  },
  {
    label: "Dependencias semanales",
    name: "Revisar dependencias",
    prompt: "Revisa las dependencias desactualizadas y con vulnerabilidades conocidas. Prioriza por riesgo y sugiere las actualizaciones seguras. No modifiques nada.",
    when: { kind: "daily", time: "10:00", days: [1] },
    permissionMode: "plan",
  },
  {
    label: "TODOs",
    name: "Revisar TODOs",
    prompt: "Busca TODO/FIXME en el código, agrúpalos por área y señala los 5 más importantes de abordar.",
    when: { kind: "daily", time: "17:00", days: [5] },
    permissionMode: "plan",
  },
];

type Draft = { name: string; projectPath: string; prompt: string; when: ScheduleWhen; permissionMode: string; model: string; budget: string };

function ScheduleDialog({ schedule, projects, onClose }: { schedule: Schedule | null; projects: ProjectListItem[]; onClose: () => void }) {
  const [d, setD] = React.useState<Draft>(() =>
    schedule
      ? { name: schedule.name, projectPath: schedule.projectPath, prompt: schedule.prompt, when: schedule.when, permissionMode: schedule.permissionMode, model: schedule.model ?? "", budget: schedule.maxBudgetUsd ? String(schedule.maxBudgetUsd) : "" }
      : { name: "", projectPath: projects[0]?.path ?? "", prompt: "", when: { kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] }, permissionMode: "plan", model: "", budget: "1" },
  );
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const w = d.when;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name: d.name, projectPath: d.projectPath, prompt: d.prompt, when: d.when, permissionMode: d.permissionMode, model: d.model || undefined, maxBudgetUsd: d.budget ? Number(d.budget) : undefined };
    try {
      if (schedule) await api("PATCH", `${KEY}/${schedule.id}`, body);
      else await api("POST", KEY, body);
      toast.success(schedule ? "Programación guardada" : "Programación creada", { description: describeWhen(d.when) });
      refresh(KEY);
      onClose();
    } catch (err) {
      toast.error("No se pudo guardar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{schedule ? "Editar programación" : "Nueva programación"}</DialogTitle>
            <DialogDescription>Claude Code se ejecutará solo en segundo plano mientras Agentic esté abierta.</DialogDescription>
          </DialogHeader>
          {!schedule && (
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setD((x) => ({ ...x, name: p.name, prompt: p.prompt, when: p.when, permissionMode: p.permissionMode }))}
                  className="cursor-pointer rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sch-name">Nombre</Label>
              <Input id="sch-name" value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sch-project">Proyecto</Label>
              <select id="sch-project" value={d.projectPath} onChange={(e) => set("projectPath", e.target.value)} className="h-9 rounded-md border bg-inset px-2 text-sm" required>
                {!projects.length && <option value="">Sin proyectos</option>}
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sch-prompt">Qué debe hacer Claude</Label>
            <Textarea id="sch-prompt" rows={4} value={d.prompt} onChange={(e) => set("prompt", e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label>Cuándo</Label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border bg-inset p-0.5">
                {(
                  [
                    ["daily", "Días y hora"],
                    ["interval", "Cada X horas"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={w.kind === k}
                    onClick={() => set("when", k === "daily" ? { kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] } : { kind: "interval", hours: 4 })}
                    className={cn("cursor-pointer rounded-md px-3 py-1 text-sm", w.kind === k ? "bg-accent text-foreground" : "text-muted-foreground")}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {w.kind === "daily" ? (
                <>
                  <div className="flex gap-1" role="group" aria-label="Días">
                    {DAYS.map(({ d: day, l }) => {
                      const on = w.days.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set("when", { ...w, days: on ? w.days.filter((x) => x !== day) : [...w.days, day] })}
                          className={cn("size-8 cursor-pointer rounded-md border text-xs font-medium", on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:border-border-strong")}
                        >
                          {l}
                        </button>
                      );
                    })}
                  </div>
                  <Input aria-label="Hora" type="time" value={w.time} onChange={(e) => set("when", { ...w, time: e.target.value })} className="h-8 w-28" required />
                </>
              ) : (
                <Input aria-label="Horas" type="number" min={1} max={168} value={w.hours} onChange={(e) => set("when", { kind: "interval", hours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })} className="h-8 w-24" />
              )}
            </div>
            <span className="text-xs text-muted-foreground">{w.kind === "daily" && !w.days.length ? "Elige al menos un día" : describeWhen(w)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="sch-mode">Permisos</Label>
              <select id="sch-mode" value={d.permissionMode} onChange={(e) => set("permissionMode", e.target.value)} className="h-9 rounded-md border bg-inset px-2 text-sm">
                {MODES.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.l}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sch-model">Modelo</Label>
              <select id="sch-model" value={d.model} onChange={(e) => set("model", e.target.value)} className="h-9 rounded-md border bg-inset px-2 text-sm">
                <option value="">Por defecto</option>
                {["sonnet", "opus", "haiku", "fable"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sch-budget">Máx. USD</Label>
              <Input id="sch-budget" type="number" min="0" step="0.5" placeholder="sin límite" value={d.budget} onChange={(e) => set("budget", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || (w.kind === "daily" && !w.days.length)}>
              {busy ? "Guardando…" : schedule ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SchedulesPage() {
  const { data, error } = useApi<{ schedules: Schedule[] }>(KEY, { refreshInterval: 30_000 });
  const { data: projectsData } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const projects = (projectsData?.projects ?? []).filter((p) => p.exists);
  const [editing, setEditing] = React.useState<Schedule | "new" | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      refresh(KEY, "/api/runs");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={AlarmClockIcon}
        title="Programadas"
        description="Trabajos recurrentes de Claude Code: resúmenes diarios, tests nocturnos, revisiones semanales…"
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Nueva programación
          </Button>
        }
      />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!data && !error && <Skeleton className="h-40" />}
      {data && !data.schedules.length && (
        <EmptyState
          icon={AlarmClockIcon}
          title="Nada programado"
          description="Programa a Claude para que haga cosas solo: un resumen cada mañana, los tests cada noche…"
          action={
            <Button size="sm" onClick={() => setEditing("new")}>
              <PlusIcon /> Nueva programación
            </Button>
          }
        />
      )}
      {!!data?.schedules.length && (
        <div className="grid gap-3">
          {data.schedules.map((s) => (
            <Card key={s.id} className={cn("flex min-w-0 flex-row flex-wrap items-center gap-4 p-4", !s.enabled && "opacity-60")}>
              <Switch checked={s.enabled} aria-label={`Activar ${s.name}`} onCheckedChange={(v) => act(() => api("PATCH", `${KEY}/${s.id}`, { enabled: v }), v ? "Programación activada" : "Programación pausada")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-muted-foreground">{describeWhen(s.when)}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <FolderIcon className="size-3" /> {baseName(s.projectPath)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {s.enabled && s.nextRunAt && <span>Próxima: {untilText(s.nextRunAt)}</span>}
                  {s.lastRunId && (
                    <Link href={`/runs/${s.lastRunId}`} className="text-link hover:underline">
                      Última: {timeAgo(s.lastRunAt)}
                    </Link>
                  )}
                  {s.lastError && (
                    <span className="flex items-center gap-1 text-warning">
                      <TriangleAlertIcon className="size-3" /> {s.lastError}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => act(() => api("POST", `${KEY}/${s.id}/run`), `«${s.name}» lanzada`)}>
                  <PlayIcon /> Ejecutar ahora
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}>
                  <PencilIcon />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Borrar ${s.name}`} className="hover:text-destructive" onClick={() => confirm(`¿Borrar «${s.name}»?`) && act(() => api("DELETE", `${KEY}/${s.id}`), "Programación borrada")}>
                  <Trash2Icon />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <ScheduleDialog schedule={editing === "new" ? null : editing} projects={projects} onClose={() => setEditing(null)} />}
    </div>
  );
}
