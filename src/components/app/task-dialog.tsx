"use client";

import * as React from "react";
import { CopyIcon, ExternalLinkIcon, GitBranchIcon, GitCommitHorizontalIcon, GitPullRequestCreateArrowIcon, PlusIcon, RocketIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, refresh, useApi, type ProjectListItem, type Task } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import type { TaskWorktree, WorktreeStatus } from "@/lib/server/worktrees";
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
      worktree: !!saved.worktree,
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
          {task?.worktree && <WorktreePanel taskId={task.id} title={d.title} description={d.description} />}
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

/** Branch, pending changes and commits of the task's isolated worktree. */
function WorktreePanel({ taskId, title, description }: { taskId: string; title: string; description: string }) {
  const key = `/api/tasks/${taskId}/worktree`;
  const { data } = useApi<{ worktree: TaskWorktree | null; status: WorktreeStatus | null; pullRequest: Task["pullRequest"] }>(key, { refreshInterval: 10_000 });
  const [busy, setBusy] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  if (!data?.worktree) return null;
  const { worktree: wt, status, pullRequest: pr } = data;
  const hasWork = !!status && (status.ahead > 0 || status.changedFiles.length > 0);

  async function remove(deleteBranch: boolean) {
    const msg = deleteBranch
      ? `¿Quitar el worktree y BORRAR la rama ${wt.branch}? Se perderán los commits que no hayas fusionado.`
      : `¿Quitar la carpeta del worktree? La rama ${wt.branch} y sus commits se conservan.`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await api("DELETE", `${key}${deleteBranch ? "?deleteBranch=1" : ""}`);
      toast.success(deleteBranch ? "Worktree y rama eliminados" : "Worktree quitado", { description: deleteBranch ? undefined : `La rama ${wt.branch} sigue en el repo.` });
      refresh("/api/tasks", key);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Worktree" className="grid gap-2 rounded-lg border bg-inset p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <GitBranchIcon className="size-4 shrink-0 text-purple" />
        <code className="min-w-0 truncate font-medium">{wt.branch}</code>
        {wt.base && <span className="text-xs text-muted-foreground">desde {wt.base}</span>}
        <span className="ml-auto flex gap-1">
          {pr ? (
            <Button asChild size="sm" variant="outline">
              <a href={pr.url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> PR #{pr.number}
              </a>
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={!hasWork || busy} title={hasWork ? undefined : "Aún no hay cambios en la rama"} onClick={() => setCreating(true)}>
              <GitPullRequestCreateArrowIcon /> Crear PR
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => copyText(wt.path).then((ok) => (ok ? toast.success("Ruta copiada") : toast.error("No se pudo copiar")))}>
            <CopyIcon /> Ruta
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => remove(false)}>
            Quitar
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label="Quitar worktree y borrar la rama" className="hover:text-destructive" onClick={() => remove(true)}>
            <Trash2Icon />
          </Button>
        </span>
      </div>
      {status && !status.exists && <p className="text-xs text-warning">La carpeta ya no existe. Al volver a ejecutar se crea de nuevo con la misma rama.</p>}
      {status?.exists && (
        <div className="grid gap-1 text-xs text-muted-foreground">
          <span>
            {status.ahead} commit{status.ahead === 1 ? "" : "s"} en la rama · {status.changedFiles.length} fichero{status.changedFiles.length === 1 ? "" : "s"} sin commit
          </span>
          {status.commits.slice(0, 5).map((c) => (
            <span key={c.hash} className="flex min-w-0 items-center gap-1.5">
              <GitCommitHorizontalIcon className="size-3 shrink-0" /> <code>{c.hash}</code> <span className="truncate">{c.subject}</span>
            </span>
          ))}
        </div>
      )}
      {creating && <CreatePrDialog taskId={taskId} defaultTitle={title} defaultBody={description} pending={status?.changedFiles.length ?? 0} onClose={() => setCreating(false)} />}
    </section>
  );
}

function CreatePrDialog({ taskId, defaultTitle, defaultBody, pending, onClose }: { taskId: string; defaultTitle: string; defaultBody: string; pending: number; onClose: () => void }) {
  const [title, setTitle] = React.useState(defaultTitle);
  const [body, setBody] = React.useState(defaultBody);
  const [draft, setDraft] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      const t = await api<Task>("POST", `/api/tasks/${taskId}/worktree/pr`, { title, body, draft });
      toast.success(`PR #${t.pullRequest?.number} creada`, { description: "La tarea pasa a Revisión." });
      refresh("/api/tasks");
      onClose();
    } catch (e) {
      toast.error("No se pudo crear la PR", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear pull request</DialogTitle>
          <DialogDescription>
            {pending > 0 ? `Se hará commit de ${pending} fichero${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"}, ` : ""}se sube la rama y se abre la PR en GitHub o Bitbucket.
          </DialogDescription>
        </DialogHeader>
        <Input aria-label="Título de la PR" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={250} />
        <Textarea aria-label="Descripción de la PR" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Qué cambia y por qué…" />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} /> Abrir como borrador
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy || !title.trim()} onClick={submit}>
            <GitPullRequestCreateArrowIcon /> {busy ? "Creando…" : "Crear PR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
