"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, GitBranchIcon, RocketIcon, TerminalSquareIcon, ZapIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api, refresh, useApi, type Agent, type ProjectListItem, type Run, type SystemInfo } from "@/lib/api";
import { cn, shortPath } from "@/lib/utils";
import { errorMessage } from "./common";

export interface LaunchOptions {
  projectPath?: string | null;
  prompt?: string;
  resumeSessionId?: string;
  taskId?: string;
  agent?: string;
  title?: string;
  /** Tasks only: run in the task's own git worktree (preselected when it already has one). */
  worktree?: boolean;
}

const LauncherContext = React.createContext<{ open: (o?: LaunchOptions) => void }>({ open: () => {} });
export const useLauncher = () => React.useContext(LauncherContext);

const DEFAULT = "__default";
const OTHER = "__other";
const MODELS = ["sonnet", "opus", "haiku", "fable"];
const PERMISSIONS: { value: string; label: string; hint: string }[] = [
  { value: "default", label: "Por defecto", hint: "Pide confirmación para acciones sensibles (en headless se deniegan)." },
  { value: "plan", label: "Plan", hint: "Sólo planifica, no modifica nada." },
  { value: "acceptEdits", label: "Aceptar ediciones", hint: "Edita ficheros sin preguntar." },
  { value: "auto", label: "Auto", hint: "Decide automáticamente qué acciones son seguras." },
  { value: "bypassPermissions", label: "Sin permisos (peligroso)", hint: "Ejecuta cualquier herramienta sin preguntar. Úsalo sólo en entornos aislados." },
];

export function LauncherProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<LaunchOptions | null>(null);
  const open = React.useCallback((o: LaunchOptions = {}) => setOpts(o), []);
  return (
    <LauncherContext.Provider value={{ open }}>
      {children}
      {opts && <LaunchDialog key={JSON.stringify(opts)} initial={opts} onClose={() => setOpts(null)} />}
    </LauncherContext.Provider>
  );
}

function LaunchDialog({ initial, onClose }: { initial: LaunchOptions; onClose: () => void }) {
  const router = useRouter();
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const { data: agentsData } = useApi<{ agents: Agent[] }>("/api/agents");
  const { data: system } = useApi<SystemInfo>("/api/system");

  const [projectChoice, setProject] = React.useState<string>(initial.projectPath || "");
  const [customPath, setCustomPath] = React.useState("");
  const [mode, setMode] = React.useState<"headless" | "tmux">("headless");
  const [prompt, setPrompt] = React.useState(initial.prompt ?? "");
  const [agent, setAgent] = React.useState(initial.agent ?? DEFAULT);
  const [model, setModel] = React.useState(DEFAULT);
  const [permissionMode, setPermissionMode] = React.useState("default");
  const [budget, setBudget] = React.useState("");
  const [worktree, setWorktree] = React.useState(!!initial.worktree);
  const [busy, setBusy] = React.useState(false);

  const projectList = (projects?.projects ?? []).filter((p) => p.exists);
  const project = projectChoice || projectList[0]?.path || "";

  const effectivePath = project === OTHER ? customPath.trim() : project;
  const agents = (agentsData?.agents ?? []).filter((a) => a.scope === "user" || a.projectPath === effectivePath);
  const perm = PERMISSIONS.find((p) => p.value === permissionMode)!;
  const canSubmit = !!effectivePath && (mode === "tmux" || prompt.trim().length > 0) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const body = {
        mode,
        projectPath: effectivePath,
        prompt,
        agent: agent === DEFAULT ? undefined : agent,
        model: model === DEFAULT ? undefined : model,
        permissionMode,
        resumeSessionId: initial.resumeSessionId,
        maxBudgetUsd: budget ? Number(budget) : undefined,
        ...(initial.taskId ? { worktree } : {}),
      };
      const run = initial.taskId ? await api<Run>("POST", `/api/tasks/${initial.taskId}/run`, body) : await api<Run>("POST", "/api/runs", body);
      toast.success(mode === "tmux" ? "Sesión interactiva creada en tmux" : "Ejecución lanzada", { description: shortPath(run.projectPath) });
      refresh("/api/runs", "/api/overview", "/api/tasks");
      onClose();
      router.push(`/runs/${run.id}`);
    } catch (err) {
      toast.error("No se pudo lanzar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RocketIcon className="size-4 text-primary" />
              {initial.title ?? (initial.resumeSessionId ? "Continuar sesión" : "Nueva sesión de Claude Code")}
            </DialogTitle>
            <DialogDescription>Lanza Claude Code en uno de tus proyectos locales.</DialogDescription>
          </DialogHeader>

          {initial.resumeSessionId && (
            <Badge variant="purple" className="font-mono">
              --resume {initial.resumeSessionId.slice(0, 8)}…
            </Badge>
          )}

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { v: "headless", icon: ZapIcon, t: "Headless", d: "Se ejecuta en segundo plano; ves el log en vivo." },
                { v: "tmux", icon: TerminalSquareIcon, t: "Interactiva (tmux)", d: system?.tmux === false ? "tmux no está instalado" : "Sesión completa; puedes hacer attach desde tu terminal." },
              ] as const
            ).map((o) => (
              <button
                type="button"
                key={o.v}
                disabled={o.v === "tmux" && system?.tmux === false}
                onClick={() => setMode(o.v)}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  mode === o.v ? "border-primary bg-primary/10" : "hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <o.icon className="size-4" /> {o.t}
                </span>
                <span className="text-xs text-muted-foreground">{o.d}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="launch-project">Proyecto</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="launch-project">
                <SelectValue placeholder="Selecciona un proyecto" />
              </SelectTrigger>
              <SelectContent>
                {projectList.map((p) => (
                  <SelectItem key={p.path} value={p.path}>
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{shortPath(p.path)}</span>
                  </SelectItem>
                ))}
                {initial.projectPath && !projectList.some((p) => p.path === initial.projectPath) && (
                  <SelectItem value={initial.projectPath}>{shortPath(initial.projectPath)}</SelectItem>
                )}
                <SelectItem value={OTHER}>Otra ruta…</SelectItem>
              </SelectContent>
            </Select>
            {project === OTHER && (
              <Input autoFocus placeholder="/ruta/absoluta/al/proyecto" value={customPath} onChange={(e) => setCustomPath(e.target.value)} className="font-mono" />
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="launch-prompt">Prompt {mode === "tmux" && <span className="text-muted-foreground/70">(opcional)</span>}</Label>
            <Textarea
              id="launch-prompt"
              autoFocus={project !== OTHER}
              rows={6}
              placeholder="¿Qué quieres que haga Claude?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
              }}
              className="max-h-72 font-mono text-[13px]"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Agente</Label>
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Ninguno</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={`${a.scope}-${a.name}`} value={a.name}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Modelo</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Por defecto</SelectItem>
                  {MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
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
                  {PERMISSIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className={cn("-mt-1 flex items-start gap-1.5 text-xs", permissionMode === "bypassPermissions" ? "text-destructive" : "text-muted-foreground")}>
            {permissionMode === "bypassPermissions" && <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />}
            {perm.hint}
          </p>

          {mode === "headless" && (
            <div className="grid gap-1.5 sm:w-1/3">
              <Label htmlFor="launch-budget">Presupuesto máx. (USD)</Label>
              <Input id="launch-budget" type="number" min="0" step="0.5" placeholder="sin límite" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          )}

          {initial.taskId && (
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", worktree ? "border-primary bg-primary/10" : "hover:bg-accent")}>
              <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <GitBranchIcon className="size-4" /> Trabajar en un worktree aislado
                </span>
                <span className="text-xs text-muted-foreground">Claude trabaja en su propia rama y carpeta: tu copia del repo no se toca y puedes lanzar varias tareas a la vez.</span>
              </span>
            </label>
          )}

          <DialogFooter className="items-center">
            <span className="mr-auto hidden text-xs text-muted-foreground sm:block">Ctrl/⌘ + Enter para lanzar</span>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              <RocketIcon /> {busy ? "Lanzando…" : "Lanzar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
