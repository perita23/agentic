"use client";

import * as React from "react";
import { GlobeIcon, KeyRoundIcon, PlusIcon, ServerIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AgenticMcpCard } from "@/components/app/agentic-mcp-card";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { api, refresh, useApi, type ProjectListItem } from "@/lib/api";

type Scope = "user" | "local" | "project";
interface McpServer {
  name: string;
  scope: Scope;
  projectPath: string | null;
  type: "stdio" | "http" | "sse";
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
}

const SCOPE: Record<Scope, { label: string; help: string }> = {
  user: { label: "Todos tus proyectos", help: "Disponible en cualquier proyecto (~/.claude.json)." },
  local: { label: "Sólo este proyecto (privado)", help: "Sólo en ese proyecto y sólo para ti." },
  project: { label: "Proyecto (compartido)", help: "Se guarda en .mcp.json del proyecto y se comparte por git." },
};

/** Well-known servers, pre-filled (the user only adds keys when needed). */
const PRESETS: { id: string; label: string; description: string; type: "stdio" | "http"; command?: string; args?: string[]; url?: string; env?: string[] }[] = [
  { id: "playwright", label: "Playwright", description: "Controla un navegador: navegar, rellenar formularios, capturas.", type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
  { id: "context7", label: "Context7", description: "Documentación actualizada de librerías y frameworks.", type: "http", url: "https://mcp.context7.com/mcp" },
  { id: "github", label: "GitHub", description: "Issues, PRs y repos de GitHub (necesita un token).", type: "http", url: "https://api.githubcopilot.com/mcp/" },
  { id: "filesystem", label: "Sistema de ficheros", description: "Leer y escribir en una carpeta concreta.", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"] },
  { id: "sequential-thinking", label: "Sequential thinking", description: "Razonamiento paso a paso para problemas largos.", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
];

function AddDialog({ projects, onClose }: { projects: ProjectListItem[]; onClose: () => void }) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<"stdio" | "http" | "sse">("stdio");
  const [command, setCommand] = React.useState("");
  const [args, setArgs] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("user");
  const [projectPath, setProjectPath] = React.useState("");
  const [secrets, setSecrets] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  function preset(p: (typeof PRESETS)[number]) {
    setName(p.id);
    setType(p.type);
    setCommand(p.command ?? "");
    setArgs((p.args ?? []).join(" "));
    setUrl(p.url ?? "");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // "KEY=value" lines: env vars for local servers, headers ("Name: value") for remote ones.
    const pairs = secrets
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    for (const l of pairs) {
      if (type === "stdio") {
        const i = l.indexOf("=");
        if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      } else {
        const i = l.indexOf(":");
        if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      }
    }
    try {
      await api("POST", "/api/mcp", {
        name: name.trim(),
        type,
        scope,
        projectPath: scope === "user" ? null : projectPath,
        command: type === "stdio" ? command.trim() : undefined,
        args: type === "stdio" ? args.trim().split(/\s+/).filter(Boolean) : [],
        url: type !== "stdio" ? url.trim() : undefined,
        env,
        headers,
      });
      toast.success(`Servidor «${name}» añadido`, { description: "Claude Code lo usará en las próximas sesiones." });
      refresh("/api/mcp");
      onClose();
    } catch (err) {
      toast.error("No se pudo añadir", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>Añadir servidor MCP</DialogTitle>
            <DialogDescription>Elige uno popular o escribe el tuyo. Se añade con «claude mcp add».</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" title={p.description} onClick={() => preset(p)} className="cursor-pointer rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground">
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-name">Nombre</Label>
              <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="playwright" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-type">Tipo</Label>
              <select id="mcp-type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="h-9 rounded-md border bg-inset px-2 text-sm">
                <option value="stdio">Local (comando)</option>
                <option value="http">Remoto (HTTP)</option>
                <option value="sse">Remoto (SSE)</option>
              </select>
            </div>
          </div>
          {type === "stdio" ? (
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-cmd">Comando</Label>
                <Input id="mcp-cmd" className="font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-args">Argumentos</Label>
                <Input id="mcp-args" className="font-mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @playwright/mcp@latest" />
              </div>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-url">URL</Label>
              <Input id="mcp-url" className="font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-secrets">{type === "stdio" ? "Variables de entorno (una por línea: CLAVE=valor)" : "Cabeceras (una por línea: Authorization: Bearer …)"}</Label>
            <textarea id="mcp-secrets" rows={2} value={secrets} onChange={(e) => setSecrets(e.target.value)} className="rounded-md border bg-inset p-2 font-mono text-xs" placeholder={type === "stdio" ? "API_KEY=…" : "Authorization: Bearer …"} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-scope">Dónde</Label>
            <select id="mcp-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="h-9 rounded-md border bg-inset px-2 text-sm">
              {(Object.keys(SCOPE) as Scope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE[s].label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">{SCOPE[scope].help}</span>
          </div>
          {scope !== "user" && (
            <select aria-label="Proyecto" value={projectPath} onChange={(e) => setProjectPath(e.target.value)} className="h-9 rounded-md border bg-inset px-2 text-sm" required>
              <option value="">Elige un proyecto…</option>
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              <PlusIcon /> {busy ? "Añadiendo…" : "Añadir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function McpPage() {
  const { data, error } = useApi<{ servers: McpServer[]; configFile: string }>("/api/mcp");
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [adding, setAdding] = React.useState(false);
  const name = (p: string | null) => (p ? (projects?.projects.find((x) => x.path === p)?.name ?? p.split("/").pop()) : null);

  async function remove(s: McpServer) {
    if (!confirm(`¿Quitar el servidor «${s.name}»?`)) return;
    try {
      await api("POST", "/api/mcp/remove", { name: s.name, scope: s.scope, projectPath: s.projectPath });
      toast.success(`«${s.name}» quitado`);
      refresh("/api/mcp");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const groups: { scope: Scope; items: McpServer[] }[] = (["user", "local", "project"] as Scope[]).map((scope) => ({ scope, items: (data?.servers ?? []).filter((s) => s.scope === scope) }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={ServerIcon}
        title="Servidores MCP"
        description="Las herramientas extra que Claude Code puede usar: navegador, documentación, GitHub… Sin editar JSON."
        actions={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Añadir servidor
          </Button>
        }
      />
      <AgenticMcpCard />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!data && !error && <Skeleton className="h-40" />}
      {data && !data.servers.length && (
        <EmptyState
          icon={ServerIcon}
          title="Sin servidores MCP"
          description="Añade uno popular (Playwright, Context7…) para darle a Claude nuevas herramientas."
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <PlusIcon /> Añadir servidor
            </Button>
          }
        />
      )}
      {data &&
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <Card key={g.scope}>
              <CardHeader>
                <div>
                  <CardTitle>{SCOPE[g.scope].label}</CardTitle>
                  <CardDescription>{SCOPE[g.scope].help}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2">
                {g.items.map((s) => (
                  <div key={`${s.scope}:${s.projectPath}:${s.name}`} className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-inset">{s.type === "stdio" ? <TerminalIcon className="size-4" /> : <GlobeIcon className="size-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {s.name}
                        <Badge>{s.type}</Badge>
                        {name(s.projectPath) && <Badge>{name(s.projectPath)}</Badge>}
                        {[...s.envKeys, ...s.headerKeys].length > 0 && (
                          <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground" title="Valores ocultos">
                            <KeyRoundIcon className="size-3" /> {[...s.envKeys, ...s.headerKeys].join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground" title={s.url ?? [s.command, ...s.args].join(" ")}>
                        {s.url ?? [s.command, ...s.args].join(" ")}
                      </div>
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label={`Quitar ${s.name}`} className="hover:text-destructive" onClick={() => remove(s)}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
      {adding && <AddDialog projects={projects?.projects ?? []} onClose={() => setAdding(false)} />}
    </div>
  );
}
