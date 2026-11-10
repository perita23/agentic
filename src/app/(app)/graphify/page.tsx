"use client";

import * as React from "react";
import { GraphDialog } from "@/components/app/graph-dialog";
import { CheckCircle2Icon, CircleDashedIcon, ExternalLinkIcon, FileTextIcon, GitBranchIcon, ShareIcon, LoaderCircleIcon, NetworkIcon, PlayIcon, RefreshCwIcon, SearchIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CopyButton, errorMessage, PageHeader } from "@/components/app/common";
import { api, refresh, useApi } from "@/lib/api";
import { shortPath, timeAgo } from "@/lib/utils";

interface Overview {
  settings: { useInRuns: boolean; strictHook: boolean };
  installed: boolean;
  version: string | null;
  installers: { uv: boolean; pipx: boolean; pip: boolean };
  projects: { path: string; name: string }[];
}
interface ProjectStatus {
  path: string;
  hasGraph: boolean;
  updatedAt: string | null;
  summary: { nodes: number; edges: number; inferredPct: number | null; version: string | null } | null;
  graphBytes: number;
  report: { bytes: number; tokens: number } | null;
  hasHtml: boolean;
  source: { bytes: number; files: number; tokens: number; truncated: boolean };
  hook: boolean;
  skill: boolean;
  claudeHook: boolean;
  claudeMd: boolean;
}
interface RunResult {
  ok: boolean;
  output: string;
  ms: number;
  status: ProjectStatus;
}

const REPO = "https://github.com/safishamsi/graphify";
const PYPI = "https://pypi.org/project/graphifyy/";
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));

function Cmd({ cmd, note }: { cmd: string; note?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 rounded-md border bg-secondary/40 py-1 pr-1 pl-3 font-mono text-xs">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{cmd}</code>
        <CopyButton value={cmd} label="Copiar comando" />
      </div>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function GraphifyPage() {
  const { data, mutate } = useApi<Overview>("/api/graphify", { refreshInterval: 30_000 });
  const [path, setPath] = React.useState<string | null>(null);
  const current = path ?? data?.projects[0]?.path ?? null;

  async function setUse(patch: { useInRuns?: boolean; strictHook?: boolean }) {
    try {
      await api("PUT", "/api/graphify", patch);
      await mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={NetworkIcon}
        title="Graphify"
        description="Convierte un proyecto en un grafo de conocimiento para que Claude consulte cómo se conecta el código en lugar de leer ficheros enteros."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon /> GitHub
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={PYPI} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon /> PyPI
              </a>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4" /> Qué es y para qué sirve
            </CardTitle>
            <CardDescription>Código abierto, gratuito. El código se analiza en tu equipo (tree-sitter), sin enviarlo a ningún sitio.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="font-medium">Qué hace</p>
            <p className="mt-1 text-muted-foreground">
              Lee tu proyecto una vez y guarda en <code>graphify-out/</code> un grafo (ficheros, funciones, clases, imports y relaciones), un informe <code>GRAPH_REPORT.md</code> con las piezas centrales y las comunidades, y una vista <code>graph.html</code>.
            </p>
          </div>
          <div>
            <p className="font-medium">Cómo ahorra contexto</p>
            <p className="mt-1 text-muted-foreground">
              Claude pregunta al grafo («¿qué conecta la autenticación con la base de datos?») y recibe un fragmento pequeño, en vez de hacer grep y abrir muchos ficheros. Cada consulta cuesta tokens, así que el ahorro real depende de lo grande que sea el proyecto y de cómo trabajes: en proyectos pequeños puede no compensar.
            </p>
          </div>
          <div>
            <p className="font-medium">Qué hace Agentic por ti</p>
            <p className="mt-1 text-muted-foreground">Detecta Graphify, te da los comandos de instalación, construye y actualiza el grafo de cada proyecto, lo consulta desde aquí y, en las ejecuciones, le dice a Claude que lo mire antes de buscar.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              {data?.installed ? <CheckCircle2Icon className="size-4 text-success" /> : <CircleDashedIcon className="size-4 text-muted-foreground" />} Instalación
              {data && <Badge variant={data.installed ? "green" : "default"}>{data.installed ? `Instalado${data.version ? ` · ${data.version}` : ""}` : "No instalado"}</Badge>}
            </CardTitle>
            <CardDescription>
              El paquete se llama <b>graphifyy</b> (con dos «y»); el comando es <code>graphify</code>. Necesita Python 3.10 o superior.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetch("/api/graphify?fresh=1", { credentials: "same-origin" }).then(() => mutate())}>
            <RefreshCwIcon /> Comprobar de nuevo
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data && !data.installed && (
            <>
              <p className="text-sm text-muted-foreground">Ejecuta esto en una terminal (usa el instalador que tengas; marcado abajo si lo he encontrado):</p>
              <Cmd cmd="uv tool install graphifyy" note={data.installers.uv ? "uv detectado (recomendado)." : "Necesita uv (https://docs.astral.sh/uv/)."} />
              <Cmd cmd="pipx install graphifyy" note={data.installers.pipx ? "pipx detectado." : undefined} />
              <Cmd cmd="pip install graphifyy" note={data.installers.pip ? "pip detectado. Mejor dentro de un entorno virtual." : undefined} />
              <p className="text-sm text-muted-foreground">Después, para registrar la skill de Graphify en Claude Code:</p>
              <Cmd cmd="graphify install" />
              <p className="text-xs text-muted-foreground">Cuando termine, pulsa «Comprobar de nuevo». Si acabas de instalarlo y no aparece, reinicia Agentic: una app abierta desde el Dock puede no ver el PATH de tu terminal.</p>
            </>
          )}
          {data?.installed && (
            <>
              <p className="text-sm text-muted-foreground">Listo. Para actualizarlo: <code>uv tool upgrade graphifyy</code> (o <code>pipx upgrade graphifyy</code>). Extras opcionales: <code>graphifyy[mcp]</code> (servidor MCP), <code>graphifyy[pdf]</code>, <code>graphifyy[watch]</code>.</p>
              <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>
                  <span className="block font-medium">Que Claude use el grafo en las ejecuciones</span>
                  <span className="block text-xs text-muted-foreground">En los proyectos que ya tengan grafo, le dice a Claude que lea el informe y consulte el grafo antes de buscar en los ficheros.</span>
                </span>
                <Switch aria-label="Que Claude use el grafo en las ejecuciones" checked={data.settings.useInRuns} onCheckedChange={(v) => void setUse({ useInRuns: v })} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>
                  <span className="block font-medium">Hook insistente</span>
                  <span className="block text-xs text-muted-foreground">
                    Pide al hook de Graphify (el que se instala con «Registrar en Claude Code») que insista más cuando Claude vaya a buscar o leer ficheros a ciegas. Es un empujón, no un bloqueo: Claude puede seguir buscando sin el grafo. Según la documentación de Graphify; no lo he comprobado con la versión real.
                  </span>
                </span>
                <Switch aria-label="Hook insistente" checked={data.settings.strictHook} onCheckedChange={(v) => void setUse({ strictHook: v })} />
              </label>
              <p className="text-xs text-muted-foreground">Para saber si Claude lo usa de verdad: cada ejecución muestra en «Métricas» cuántas veces consultó Graphify, y en el chat y las ejecuciones cada uso se marca en morado.</p>
            </>
          )}
          {!data && <p className="text-sm text-muted-foreground">Comprobando…</p>}
        </CardContent>
      </Card>

      {data?.installed && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranchIcon className="size-4" /> Proyectos
              </CardTitle>
              <CardDescription>El grafo se guarda dentro de cada proyecto (<code>graphify-out/</code>). Construirlo solo analiza el código en local; los documentos, PDFs e imágenes necesitan además un modelo y se hacen con <code>/graphify .</code> dentro de Claude Code.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no tienes proyectos: regístralos en la sección Proyectos.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {data.projects.map((p) => (
                    <Button key={p.path} size="sm" variant={p.path === current ? "default" : "outline"} onClick={() => setPath(p.path)} title={p.path}>
                      {p.name}
                    </Button>
                  ))}
                </div>
                {current && <ProjectPanel key={current} path={current} />}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProjectPanel({ path }: { path: string }) {
  const { data, mutate } = useApi<ProjectStatus>(`/api/graphify/project?path=${encodeURIComponent(path)}`);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<{ title: string; ok: boolean; text: string } | null>(null);
  const [q, setQ] = React.useState("");
  const [report, setReport] = React.useState<string | null>(null);
  const [graphOpen, setGraphOpen] = React.useState(false);

  async function run(action: "update" | "hook" | "claude" | "query", title: string, query?: string) {
    setBusy(action);
    try {
      const r = await api<RunResult>("POST", "/api/graphify/project", { path, action, query });
      setOut({ title, ok: r.ok, text: r.output });
      await mutate(r.status, { revalidate: false });
      void refresh("/api/graphify");
      if (!r.ok) toast.error(`${title}: terminó con error`);
      else if (action !== "query") toast.success(`${title}: hecho (${Math.max(1, Math.round(r.ms / 1000))} s)`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const ratio = data.report && data.report.tokens > 0 && data.source.tokens > 0 ? data.source.tokens / data.report.tokens : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs text-muted-foreground">{shortPath(path)}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Grafo" value={data.hasGraph ? `${fmt(data.summary?.nodes ?? 0)} nodos · ${fmt(data.summary?.edges ?? 0)} relaciones` : "Sin construir"} hint={data.updatedAt ? `Actualizado ${timeAgo(data.updatedAt)}` : "Pulsa «Construir grafo»"} />
        <Fact label="Informe" value={data.report ? `≈ ${fmt(data.report.tokens)} tokens` : "—"} hint="Lo primero que lee Claude" />
        <Fact label="Código del proyecto" value={`≈ ${fmt(data.source.tokens)} tokens`} hint={`${fmt(data.source.files)}${data.source.truncated ? "+" : ""} ficheros de texto`} />
        <Fact label="Orden de magnitud" value={ratio ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× menos` : "—"} hint="Informe frente a leer todo el código. No es el ahorro real de una tarea." />
      </div>
      {data.summary?.inferredPct != null && data.summary.inferredPct > 0 && (
        <p className="text-xs text-muted-foreground">{data.summary.inferredPct}% de las relaciones son inferidas (no leídas directamente del código): tómalas como pistas.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void run("update", data.hasGraph ? "Actualizar" : "Construir grafo")} disabled={!!busy}>
          {busy === "update" ? <LoaderCircleIcon className="animate-spin" /> : data.hasGraph ? <RefreshCwIcon /> : <PlayIcon />} {data.hasGraph ? "Actualizar grafo" : "Construir grafo"}
        </Button>
        <Button variant="outline" onClick={() => void run("hook", "Hook de git")} disabled={!!busy} title="Reconstruye el grafo solo en cada commit y cambio de rama">
          {busy === "hook" ? <LoaderCircleIcon className="animate-spin" /> : <GitBranchIcon />} Hook de git {data.hook && <Badge variant="green">activo</Badge>}
        </Button>
        <Button variant="outline" onClick={() => void run("claude", "Registrar en Claude Code")} disabled={!!busy} title="Instala la skill y el aviso para Claude Code en este proyecto">
          {busy === "claude" ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />} Registrar en Claude Code {(data.skill || data.claudeMd || data.claudeHook) && <Badge variant="green">{data.claudeHook ? "con hook" : "hecho"}</Badge>}
        </Button>
        {data.hasGraph && (
          <Button variant="secondary" onClick={() => setGraphOpen(true)}>
            <ShareIcon /> Ver grafo
          </Button>
        )}
        {data.report && <ReportButton path={path} onOpen={setReport} />}
      </div>

      {data.hasGraph && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) void run("query", "Consulta", q.trim());
          }}
        >
          <div className="relative flex-1">
            <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pregunta al grafo: ¿qué conecta el login con la base de datos?" maxLength={500} />
          </div>
          <Button type="submit" variant="secondary" disabled={!!busy || !q.trim()}>
            {busy === "query" ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />} Consultar
          </Button>
        </form>
      )}

      {out && (
        <div className="rounded-md border bg-secondary/30">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
            <span className="font-medium">{out.title}</span>
            <Badge variant={out.ok ? "green" : "red"}>{out.ok ? "OK" : "Error"}</Badge>
          </div>
          <pre className="max-h-72 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">{out.text}</pre>
        </div>
      )}

      <GraphDialog path={path} open={graphOpen} onOpenChange={setGraphOpen} />
      <Dialog open={report !== null} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>GRAPH_REPORT.md</DialogTitle>
            <DialogDescription>Lo que Claude lee primero: piezas centrales, comunidades y conexiones sorprendentes.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md border bg-secondary/30 p-3 font-mono text-xs whitespace-pre-wrap">{report}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportButton({ path, onOpen }: { path: string; onOpen: (t: string) => void }) {
  const [loading, setLoading] = React.useState(false);
  return (
    <Button
      variant="outline"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const r = await fetch(`/api/graphify/report?path=${encodeURIComponent(path)}`, { credentials: "same-origin" });
          const j = (await r.json()) as { text?: string; error?: string };
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          onOpen(j.text ?? "");
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <LoaderCircleIcon className="animate-spin" /> : <FileTextIcon />} Ver informe
    </Button>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
