"use client";

import * as React from "react";
import { CopyIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { errorMessage } from "./common";

type Group = "tasks" | "runs" | "projects" | "usage" | "obsidian" | "mail";
interface View {
  settings: { enabled: boolean; write: boolean; groups: Record<Group, boolean> };
  url: string;
  tools: { name: string; title: string; description: string; group: Group; write: boolean; enabled: boolean }[];
}

const GROUPS: { id: Group; label: string; help: string }[] = [
  { id: "tasks", label: "Tareas", help: "Leer tareas, su estado y sus programaciones." },
  { id: "runs", label: "Ejecuciones y chats", help: "Ejecuciones, sesiones y conversaciones." },
  { id: "projects", label: "Proyectos", help: "Proyectos y agentes." },
  { id: "usage", label: "Consumo", help: "Tokens y uso del plan." },
  { id: "obsidian", label: "Obsidian", help: "Buscar y leer notas (la carpeta de Agentic, o todo si así lo tienes ajustado)." },
  { id: "mail", label: "Correo", help: "Leer tu bandeja. Privado: apagado por defecto." },
];

/** "Agentic para Claude": the tools Claude uses to look into Agentic itself (tasks, runs, notes…). */
export function AgenticMcpCard() {
  const { data, mutate } = useApi<View>("/api/agentic-mcp/settings");
  const [busy, setBusy] = React.useState(false);

  async function set(patch: { enabled?: boolean; write?: boolean; groups?: Partial<Record<Group, boolean>> }) {
    if (!data) return;
    const next = { ...data, settings: { ...data.settings, ...patch, groups: { ...data.settings.groups, ...patch.groups } } };
    await mutate(next, { revalidate: false });
    try {
      await api("PUT", "/api/agentic-mcp/settings", patch);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      refresh("/api/agentic-mcp/settings");
    }
  }
  async function copy() {
    try {
      const { command } = await api<{ command: string }>("POST", "/api/agentic-mcp/command");
      await navigator.clipboard.writeText(command);
      toast.success("Comando copiado: pégalo en una terminal para añadir Agentic a otro Claude Code");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function rotate() {
    if (!confirm("¿Generar una clave nueva? Los Claude Code configurados con la anterior dejarán de poder entrar (los chats de aquí no se ven afectados).")) return;
    setBusy(true);
    try {
      await api("POST", "/api/agentic-mcp/rotate");
      toast.success("Clave renovada");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Skeleton className="h-48" />;
  const s = data.settings;
  const count = data.tools.filter((t) => t.enabled).length;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4" /> Agentic para Claude
            <Badge>{s.enabled ? `${count} herramientas` : "apagado"}</Badge>
          </CardTitle>
          <CardDescription>Claude puede consultar Agentic por su cuenta: «¿qué dice esta tarea?», «¿qué hay en mis notas de Obsidian?», «¿en qué quedó aquella ejecución?». Funciona en los chats y ejecuciones de aquí.</CardDescription>
        </div>
        <Switch aria-label="Activar las herramientas de Agentic para Claude" checked={s.enabled} onCheckedChange={(on) => set({ enabled: on })} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {GROUPS.map((g) => (
          <label key={g.id} className="flex items-center justify-between gap-4">
            <span>
              {g.label}
              <span className="block text-xs text-muted-foreground">{g.help}</span>
            </span>
            <Switch aria-label={`Que Claude vea: ${g.label}`} checked={s.groups[g.id]} disabled={!s.enabled} onCheckedChange={(on) => set({ groups: { [g.id]: on } })} />
          </label>
        ))}
        <label className="flex items-center justify-between gap-4 border-t pt-3">
          <span>
            Dejar que Claude escriba
            <span className="block text-xs text-muted-foreground">Crear y editar tareas y escribir notas en la carpeta de Agentic de Obsidian. Apagado: sólo lee.</span>
          </span>
          <Switch aria-label="Que Claude pueda escribir en Agentic" checked={s.write} disabled={!s.enabled} onCheckedChange={(on) => set({ write: on })} />
        </label>
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Ver las herramientas ({count} activas de {data.tools.length})</summary>
          <ul className="mt-2 grid gap-1.5">
            {data.tools.map((t) => (
              <li key={t.name} className={t.enabled ? "" : "opacity-50"}>
                <code className="text-xs">{t.name}</code>
                {t.write && <Badge className="ml-2">escribe</Badge>}
                <span className="block text-xs text-muted-foreground">{t.description}</span>
              </li>
            ))}
          </ul>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            <CopyIcon /> Copiar comando para otro Claude Code
          </Button>
          <Button size="sm" variant="ghost" onClick={rotate} disabled={busy}>
            <RefreshCwIcon /> Renovar clave
          </Button>
          <span className="truncate font-mono text-[11px] text-muted-foreground">{data.url}</span>
        </div>
      </CardContent>
    </Card>
  );
}
