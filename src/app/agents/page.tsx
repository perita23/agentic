"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { BotIcon, FolderIcon, PencilIcon, PlusIcon, RocketIcon, Trash2Icon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { api, refresh, useApi, type Agent, type ProjectListItem } from "@/lib/api";
import { baseName, shortPath } from "@/lib/utils";

const DEFAULT = "__default";

function AgentEditor({ agent, onClose }: { agent?: Agent; onClose: () => void }) {
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [scope, setScope] = React.useState<"user" | "project">(agent?.scope ?? "user");
  const [projectPath, setProjectPath] = React.useState(agent?.projectPath ?? "");
  const [name, setName] = React.useState(agent?.name ?? "");
  const [description, setDescription] = React.useState(agent?.description ?? "");
  const [model, setModel] = React.useState(agent?.model ?? DEFAULT);
  const [tools, setTools] = React.useState(agent?.tools.join(", ") ?? "");
  const [prompt, setPrompt] = React.useState(agent?.prompt ?? "");
  const [busy, setBusy] = React.useState(false);
  const validName = /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      scope,
      projectPath: scope === "project" ? projectPath : null,
      name,
      description,
      model: model === DEFAULT ? "" : model,
      tools: tools.split(",").map((t) => t.trim()).filter(Boolean),
      prompt,
    };
    try {
      if (agent) {
        const qs = agent.scope === "project" ? `?projectPath=${encodeURIComponent(agent.projectPath!)}` : "";
        await api("PUT", `/api/agents/${agent.scope}/${agent.name}${qs}`, body);
      } else {
        await api("POST", "/api/agents", body);
      }
      refresh("/api/agents");
      toast.success(agent ? "Agente actualizado" : "Agente creado");
      onClose();
    } catch (err) {
      toast.error("No se pudo guardar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{agent ? `Editar ${agent.name}` : "Nuevo subagente"}</DialogTitle>
            <DialogDescription>Se guarda como Markdown en {scope === "user" ? "~/.claude/agents" : "<proyecto>/.claude/agents"}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Ámbito</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as "user" | "project")} disabled={!!agent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuario (todos los proyectos)</SelectItem>
                  <SelectItem value="project">Proyecto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "project" && (
              <div className="grid gap-1.5">
                <Label>Proyecto</Label>
                <Select value={projectPath} onValueChange={setProjectPath} disabled={!!agent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elige un proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects?.projects
                      .filter((p) => p.exists)
                      .map((p) => (
                        <SelectItem key={p.path} value={p.path}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Nombre</Label>
              <Input required disabled={!!agent} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="code-reviewer" className="font-mono" aria-invalid={!!name && !validName} />
              {!!name && !validName && <span className="text-xs text-destructive">Sólo minúsculas, números y guiones.</span>}
            </div>
            <div className="grid gap-1.5">
              <Label>Modelo</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Heredar</SelectItem>
                  {["sonnet", "opus", "haiku", "fable", "inherit"].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Descripción (cuándo debe usarse)</Label>
            <Input required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Revisa código buscando bugs y problemas de seguridad" />
          </div>
          <div className="grid gap-1.5">
            <Label>Herramientas permitidas (comas; vacío = todas)</Label>
            <Input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="Read, Grep, Glob, Bash" className="font-mono" />
          </div>
          <div className="grid gap-1.5">
            <Label>Prompt de sistema</Label>
            <Textarea required rows={10} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="font-mono text-[13px]" placeholder="Eres un revisor de código senior…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !validName || (scope === "project" && !projectPath)}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AgentsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data } = useApi<{ agents: Agent[] }>("/api/agents");
  const launcher = useLauncher();
  const [editing, setEditing] = React.useState<{ agent?: Agent } | null>(params.get("new") ? {} : null);

  async function remove(a: Agent) {
    if (!confirm(`¿Borrar el agente "${a.name}"? Se eliminará ${shortPath(a.path)}.`)) return;
    try {
      const qs = a.scope === "project" ? `?projectPath=${encodeURIComponent(a.projectPath!)}` : "";
      await api("DELETE", `/api/agents/${a.scope}/${a.name}${qs}`);
      refresh("/api/agents");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const agents = data?.agents ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={BotIcon}
        title="Agentes"
        description="Subagentes de Claude Code a nivel de usuario y de proyecto."
        actions={
          <Button onClick={() => setEditing({})}>
            <PlusIcon /> Nuevo agente
          </Button>
        }
      />
      {data && agents.length === 0 && (
        <EmptyState
          icon={BotIcon}
          title="Aún no tienes subagentes"
          description="Crea agentes especializados (revisor, tester, documentador…) y lánzalos sobre cualquier proyecto."
          action={
            <Button size="sm" onClick={() => setEditing({})}>
              <PlusIcon /> Crear agente
            </Button>
          }
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a, i) => (
          <motion.div
            key={`${a.scope}:${a.projectPath}:${a.name}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-border-strong"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-purple/25 to-primary/25 ring-1 ring-border">
                <BotIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold">{a.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {a.scope === "user" ? (
                    <>
                      <UserIcon className="size-3" /> usuario
                    </>
                  ) : (
                    <>
                      <FolderIcon className="size-3" /> {baseName(a.projectPath)}
                    </>
                  )}
                  {a.model && <Badge variant="purple">{a.model}</Badge>}
                </div>
              </div>
            </div>
            <p className="line-clamp-3 text-sm text-muted-foreground">{a.description}</p>
            {a.tools.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {a.tools.slice(0, 8).map((t) => (
                  <Badge key={t} className="font-mono">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            <div className="mt-auto flex items-center gap-2">
              <Button size="sm" onClick={() => launcher.open({ agent: a.name, projectPath: a.projectPath ?? undefined })}>
                <RocketIcon /> Lanzar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ agent: a })} aria-label="Editar">
                <PencilIcon />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(a)} aria-label="Borrar" className="ml-auto hover:text-destructive">
                <Trash2Icon />
              </Button>
            </div>
          </motion.div>
        ))}
      </div>
      {editing && (
        <AgentEditor
          agent={editing.agent}
          onClose={() => {
            setEditing(null);
            if (params.get("new")) router.replace("/agents");
          }}
        />
      )}
    </div>
  );
}

export default function AgentsPage() {
  return (
    <React.Suspense>
      <AgentsInner />
    </React.Suspense>
  );
}
