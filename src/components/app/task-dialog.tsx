"use client";

import * as React from "react";
import { PlusIcon, RocketIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, refresh, useApi, type ProjectListItem, type Task } from "@/lib/api";
import { errorMessage } from "./common";
import { useLauncher } from "./launcher";

export const STATUSES = [
  { key: "backlog", label: "Backlog", color: "bg-muted-foreground" },
  { key: "todo", label: "To do", color: "bg-primary" },
  { key: "in_progress", label: "En curso", color: "bg-warning" },
  { key: "review", label: "Revisión", color: "bg-purple" },
  { key: "done", label: "Hecho", color: "bg-success" },
] as const;
export type Status = (typeof STATUSES)[number]["key"];

export const PRIORITIES = [
  { key: "low", label: "Baja", className: "text-muted-foreground" },
  { key: "medium", label: "Media", className: "text-link" },
  { key: "high", label: "Alta", className: "text-warning" },
  { key: "urgent", label: "Urgente", className: "text-destructive" },
] as const;

const NONE = "__none";

interface Draft {
  title: string;
  description: string;
  status: Status;
  priority: Task["priority"];
  projectPath: string;
  labels: string;
  checklist: { id?: string; text: string; done: boolean }[];
  prompt: string;
  dueDate: string;
}

function toDraft(t?: Partial<Task>, defaults?: Partial<Draft>): Draft {
  return {
    title: t?.title ?? "",
    description: t?.description ?? "",
    status: (t?.status as Status) ?? defaults?.status ?? "todo",
    priority: t?.priority ?? "medium",
    projectPath: t?.projectPath ?? defaults?.projectPath ?? "",
    labels: (t?.labels ?? []).join(", "),
    checklist: t?.checklist ?? [],
    prompt: t?.prompt ?? "",
    dueDate: t?.dueDate ?? "",
  };
}

export function TaskDialog({ task, defaults, onClose }: { task?: Task; defaults?: Partial<Draft>; onClose: () => void }) {
  const [d, setD] = React.useState<Draft>(() => toDraft(task, defaults));
  const [newItem, setNewItem] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const launcher = useLauncher();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const payload = () => ({
    title: d.title,
    description: d.description,
    status: d.status,
    priority: d.priority,
    projectPath: d.projectPath || null,
    labels: d.labels
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    checklist: d.checklist,
    prompt: d.prompt,
    dueDate: d.dueDate || null,
  });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true);
    try {
      const saved = task ? await api<Task>("PATCH", `/api/tasks/${task.id}`, payload()) : await api<Task>("POST", "/api/tasks", payload());
      refresh("/api/tasks", "/api/overview");
      toast.success(task ? "Tarea guardada" : "Tarea creada");
      onClose();
      return saved;
    } catch (err) {
      toast.error("No se pudo guardar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!task || !confirm("¿Borrar esta tarea?")) return;
    try {
      await api("DELETE", `/api/tasks/${task.id}`);
      refresh("/api/tasks", "/api/overview");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function runWithClaude() {
    const saved = await save();
    if (!saved) return;
    launcher.open({
      taskId: saved.id,
      projectPath: saved.projectPath,
      prompt: saved.prompt || `${saved.title}\n\n${saved.description}`.trim(),
      title: `Ejecutar tarea: ${saved.title}`,
    });
  }

  const done = d.checklist.filter((c) => c.done).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{task ? "Editar tarea" : "Nueva tarea"}</DialogTitle>
            <DialogDescription>Planifica el trabajo y lánzalo con Claude Code cuando quieras.</DialogDescription>
          </DialogHeader>
          <Input autoFocus placeholder="Título de la tarea" value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={200} className="h-10 text-base font-medium" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Estado">
              <Select value={d.status} onValueChange={(v) => set("status", v as Status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      <span className={`size-2 rounded-full ${s.color}`} /> {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Prioridad">
              <Select value={d.priority} onValueChange={(v) => set("priority", v as Task["priority"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      <span className={p.className}>●</span> {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha límite">
              <Input type="date" value={d.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proyecto">
              <Select value={d.projectPath || NONE} onValueChange={(v) => set("projectPath", v === NONE ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin proyecto</SelectItem>
                  {projects?.projects.map((p) => (
                    <SelectItem key={p.path} value={p.path}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {d.projectPath && !projects?.projects.some((p) => p.path === d.projectPath) && <SelectItem value={d.projectPath}>{d.projectPath}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Etiquetas (separadas por comas)">
              <Input placeholder="bug, frontend" value={d.labels} onChange={(e) => set("labels", e.target.value)} />
            </Field>
          </div>
          <Field label="Descripción">
            <Textarea rows={3} value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Contexto, criterios de aceptación…" />
          </Field>
          <Field label={`Checklist ${d.checklist.length ? `(${done}/${d.checklist.length})` : ""}`}>
            <div className="flex flex-col gap-1.5">
              {d.checklist.map((c, i) => (
                <div key={c.id ?? i} className="group flex items-center gap-2">
                  <Checkbox checked={c.done} onCheckedChange={(v) => set("checklist", d.checklist.map((x, j) => (j === i ? { ...x, done: v === true } : x)))} />
                  <span className={`flex-1 text-sm ${c.done ? "text-muted-foreground line-through" : ""}`}>{c.text}</span>
                  <button type="button" aria-label="Quitar" className="cursor-pointer text-muted-foreground opacity-0 group-hover:opacity-100" onClick={() => set("checklist", d.checklist.filter((_, j) => j !== i))}>
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  placeholder="Añadir elemento…"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newItem.trim()) set("checklist", [...d.checklist, { text: newItem.trim(), done: false }]);
                      setNewItem("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Añadir"
                  onClick={() => {
                    if (newItem.trim()) set("checklist", [...d.checklist, { text: newItem.trim(), done: false }]);
                    setNewItem("");
                  }}
                >
                  <PlusIcon />
                </Button>
              </div>
            </div>
          </Field>
          <Field label="Prompt para Claude (opcional; si está vacío se usan título y descripción)">
            <Textarea rows={4} value={d.prompt} onChange={(e) => set("prompt", e.target.value)} className="font-mono text-[13px]" />
          </Field>
          <DialogFooter className="items-center">
            {task && (
              <Button type="button" variant="destructive" size="icon" onClick={remove} className="mr-auto" aria-label="Borrar tarea">
                <Trash2Icon />
              </Button>
            )}
            <Button type="button" variant="outline" onClick={runWithClaude} disabled={busy || !d.title.trim() || !d.projectPath}>
              <RocketIcon /> Guardar y ejecutar
            </Button>
            <Button type="submit" disabled={busy || !d.title.trim()}>
              {task ? "Guardar" : "Crear tarea"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
