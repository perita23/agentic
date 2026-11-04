"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftIcon, BotIcon, FileDiffIcon, CornerDownLeftIcon, ExternalLinkIcon, PlayIcon, SquareIcon, TerminalIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton, errorMessage, StatusDot } from "@/components/app/common";
import { RunDiffView } from "@/components/app/diff-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLauncher } from "@/components/app/launcher";
import { linkify } from "@/components/app/linkify";
import { ActivityOrb } from "@/components/app/liquid-orb";
import { JiraCommentButton } from "@/components/app/jira-comment";
import { UsageCard } from "@/components/app/usage-card";
import { stateFromEvents } from "@/lib/orb-state";
import { RUN_STATUS_LABEL, RUN_STATUS_VARIANT } from "@/components/app/run-row";
import { api, fetcher, refresh, useApi, type Run, type RunLog } from "@/lib/api";
import { cn, shortPath, timeAgo } from "@/lib/utils";

type Ev = RunLog["events"][number];

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join("\n");
  return "";
}

function EventView({ e, run }: { e: Ev; run: Run }) {
  const jira = (text: string) => <JiraCommentButton text={text} hints={[run.prompt, run.resultText]} taskId={run.taskId} />;
  if (e.type === "agentic" && e.subtype === "start")
    return <div className="font-mono text-xs text-muted-foreground">$ {(e.args as string[]).join(" ")}</div>;
  if (e.type === "agentic" && e.subtype === "exit")
    return <div className="font-mono text-xs text-muted-foreground">— proceso terminado (código {String(e.code ?? e.signal)}) —</div>;
  if (e.type === "agentic" && e.subtype === "log_truncated") return <div className="text-xs text-warning">Log truncado: se alcanzó el tamaño máximo.</div>;
  if (e.type === "system" && e.subtype === "init")
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="blue">init</Badge> sesión <span className="font-mono">{String(e.session_id).slice(0, 8)}</span>
        {e.model && <span>· {e.model}</span>}
        {Array.isArray(e.tools) && <span>· {e.tools.length} herramientas</span>}
      </div>
    );
  if (e.type === "assistant") {
    const blocks: Ev[] = Array.isArray(e.message?.content) ? e.message.content : [];
    return (
      <div className="flex flex-col gap-1.5">
        {blocks.map((b, i) =>
          b.type === "text" ? (
            <div key={i} className="flex gap-2">
              <BotIcon className="mt-0.5 size-4 shrink-0 text-orange" />
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{linkify(String(b.text ?? ""))}</div>
                <div className="mt-1 flex">{jira(String(b.text ?? ""))}</div>
              </div>
            </div>
          ) : b.type === "tool_use" ? (
            <details key={i} className="ml-6 rounded border bg-inset text-xs">
              <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-link">
                <WrenchIcon className="size-3" /> {b.name}
              </summary>
              <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{JSON.stringify(b.input, null, 2)}</pre>
            </details>
          ) : null,
        )}
      </div>
    );
  }
  if (e.type === "user") {
    const blocks: Ev[] = Array.isArray(e.message?.content) ? e.message.content : [];
    const results = blocks.filter((b) => b.type === "tool_result");
    if (!results.length) return null;
    return (
      <div className="ml-6 flex flex-col gap-1">
        {results.map((r, i) => (
          <details key={i} className={cn("rounded border text-xs", r.is_error ? "border-destructive/40" : "")}>
            <summary className="cursor-pointer px-2 py-1 font-mono text-muted-foreground">↳ resultado{r.is_error ? " (error)" : ""}</summary>
            <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{linkify(contentText(r.content).slice(0, 5000))}</pre>
          </details>
        ))}
      </div>
    );
  }
  if (e.type === "result")
    return (
      <div className={cn("rounded-md border p-3 text-sm", e.is_error ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5")}>
        <div className="mb-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className={e.is_error ? "text-destructive" : "text-success"}>{e.is_error ? "Error" : "Resultado"}</span>
          {typeof e.total_cost_usd === "number" && <span>${e.total_cost_usd.toFixed(4)}</span>}
          {typeof e.duration_ms === "number" && <span>{(e.duration_ms / 1000).toFixed(1)} s</span>}
          {typeof e.num_turns === "number" && <span>{e.num_turns} turnos</span>}
        </div>
        <div className="whitespace-pre-wrap break-words">{linkify(String(e.result ?? ""))}</div>
        {!e.is_error && !!e.result && <div className="mt-2 flex justify-end">{jira(String(e.result))}</div>}
      </div>
    );
  if (e.type === "stderr") return <pre className="font-mono text-xs whitespace-pre-wrap text-destructive/80">{String(e.text)}</pre>;
  if (e.type === "stdout") return <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">{String(e.text)}</pre>;
  return null;
}

function HeadlessLog({ run }: { run: Run }) {
  const [events, setEvents] = React.useState<Ev[]>([]);
  const offset = React.useRef(0);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [follow, setFollow] = React.useState(true);

  const [live, setLive] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let es: EventSource | null = null;
    let pending: Ev[] = [];
    let frame = 0;
    offset.current = 0;

    // Batch incoming lines into one state update per animation frame.
    const flush = () => {
      frame = 0;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setEvents((prev) => [...prev, ...batch].slice(-3000));
    };
    const push = (e: Ev) => {
      pending.push(e);
      if (!frame) frame = requestAnimationFrame(flush);
    };

    // Fallback: incremental polling (also used if SSE is unavailable).
    const poll = async () => {
      try {
        let more = true;
        let status = "running";
        while (more && !cancelled) {
          const log = await fetcher<RunLog>(`/api/runs/${run.id}/log?offset=${offset.current}`);
          more = log.nextOffset > offset.current && log.events.length > 0;
          offset.current = log.nextOffset;
          status = log.status;
          log.events.forEach(push);
        }
        if (!cancelled && status === "running") timer = setTimeout(poll, 1000);
        else refresh(`/api/runs/${run.id}`);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 3000);
      }
    };

    if (typeof EventSource === "undefined") {
      void poll();
    } else {
      es = new EventSource(`/api/runs/${run.id}/stream`);
      es.onopen = () => setLive(true);
      es.onmessage = (m) => {
        try {
          push(JSON.parse(m.data));
        } catch {}
        if (m.lastEventId) offset.current = Number(m.lastEventId);
      };
      es.addEventListener("end", () => {
        es?.close();
        setLive(false);
        refresh(`/api/runs/${run.id}`);
      });
      es.onerror = () => {
        // The browser retries on its own (resuming via Last-Event-ID); if it gave up, poll instead.
        if (es?.readyState === EventSource.CLOSED && !cancelled) {
          setLive(false);
          void poll();
        }
      };
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      es?.close();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [run.id]);

  React.useEffect(() => {
    // Scroll only the log container, never the whole window.
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [events, follow]);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="items-center border-b py-2.5">
        <CardTitle className="flex items-center gap-2">
          <TerminalIcon className="size-4" /> Salida
          {live && (
            <span className="flex items-center gap-1 text-[11px] font-normal text-success">
              <StatusDot status="idle" className="size-1.5" /> en vivo
            </span>
          )}
        </CardTitle>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-primary" /> Seguir
        </label>
      </CardHeader>
      <div className="flex items-center border-b bg-card px-4 py-3">
        <ActivityOrb activity={run.status === "running" ? stateFromEvents(events) : run.status === "failed" ? { state: "error", label: "Ha fallado" } : stateFromEvents(events)} size={48} />
      </div>
      <CardContent ref={scroller} className="max-h-[65vh] min-h-64 overflow-y-auto bg-inset p-4">
        <div className="flex flex-col gap-3">
          {events.map((e, i) => (
            <EventView key={i} e={e} run={run} />
          ))}
          {run.status === "running" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusDot status="running" /> Claude está trabajando…
            </div>
          )}
        </div>
      </CardContent>
      <ReplyBox run={run} />
    </Card>
  );
}

/**
 * Headless runs are one-shot, so a reply continues the same Claude session
 * (`--resume`) as a new run: send another prompt or answer a question Claude asked.
 */
function ReplyBox({ run }: { run: Run }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [mode, setMode] = React.useState(run.permissionMode || "default");
  const [busy, setBusy] = React.useState(false);
  if (run.mode !== "headless") return null;
  const waiting = run.status === "running";
  const noSession = !run.sessionId;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || waiting || noSession) return;
    setBusy(true);
    try {
      const next = await api<Run>("POST", "/api/runs", {
        mode: "headless",
        projectPath: run.projectPath,
        prompt: text.trim(),
        resumeSessionId: run.sessionId,
        permissionMode: mode,
        model: run.model || undefined,
      });
      refresh("/api/runs", "/api/overview");
      toast.success("Enviado", { description: "Claude continúa la misma conversación." });
      router.push(`/runs/${next.id}`);
    } catch (err) {
      toast.error("No se pudo enviar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="grid gap-2 border-t bg-card p-3">
      <textarea
        aria-label="Responder a Claude"
        rows={2}
        value={text}
        disabled={waiting || noSession}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
        }}
        placeholder={waiting ? "Claude está trabajando; podrás responder cuando termine…" : noSession ? "Esta ejecución no tiene sesión que continuar." : "Responde a Claude o envía otra instrucción…"}
        className="w-full resize-y rounded-md border bg-inset p-2.5 text-sm disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Permisos" value={mode} onChange={(e) => setMode(e.target.value)} className="h-8 rounded-md border bg-inset px-2 text-xs" disabled={waiting || noSession}>
          <option value="default">Permisos: preguntar</option>
          <option value="plan">Permisos: sólo planificar</option>
          <option value="acceptEdits">Permisos: aceptar ediciones</option>
        </select>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl/⌘ + Enter para enviar</span>
        <Button type="submit" size="sm" className="ml-auto" disabled={busy || waiting || noSession || !text.trim()}>
          <CornerDownLeftIcon /> {busy ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </form>
  );
}

function TmuxConsole({ run }: { run: Run }) {
  const { data } = useApi<{ text: string; alive: boolean }>(`/api/runs/${run.id}/capture`, { refreshInterval: run.status === "running" ? 1500 : 0 });
  const [input, setInput] = React.useState("");
  const pre = React.useRef<HTMLPreElement>(null);
  React.useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [data?.text]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    try {
      await api("POST", `/api/runs/${run.id}/input`, { text: input });
      setInput("");
      refresh(`/api/runs/${run.id}/capture`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="items-center border-b py-2.5">
        <CardTitle className="flex items-center gap-2">
          <TerminalIcon className="size-4" /> tmux · {run.tmuxSession}
        </CardTitle>
        <div className="flex items-center gap-1 rounded-md border bg-inset pl-2 font-mono text-xs text-muted-foreground">
          tmux attach -t {run.tmuxSession}
          <CopyButton value={`tmux attach -t ${run.tmuxSession}`} label="Copiar comando attach" />
        </div>
      </CardHeader>
      <pre ref={pre} className="max-h-[60vh] min-h-64 overflow-auto bg-inset p-4 font-mono text-[12px] leading-snug text-foreground/85">
        {data?.text || (data && !data.alive ? "La sesión de tmux ha terminado." : "Conectando…")}
      </pre>
      {run.status === "running" && (
        <form onSubmit={send} className="flex gap-2 border-t p-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe un mensaje para Claude y pulsa Enter…" className="font-mono" />
          <Button type="submit" variant="outline">
            <CornerDownLeftIcon /> Enviar
          </Button>
        </form>
      )}
    </Card>
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const launcher = useLauncher();
  const { data: run, error } = useApi<Run>(`/api/runs/${id}`, { refreshInterval: (r) => (r?.status === "running" ? 2000 : 0) });

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!run) return <Skeleton className="h-64" />;

  async function stop() {
    try {
      await api("POST", `/api/runs/${id}/stop`);
      toast.success("Ejecución detenida");
      refresh("/api/runs", "/api/overview");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function remove() {
    if (!confirm("¿Borrar esta ejecución y su log?")) return;
    try {
      await api("DELETE", `/api/runs/${id}`);
      refresh("/api/runs", "/api/overview");
      router.push("/runs");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 border-b pb-4">
        <Link href="/runs" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3" /> Ejecuciones
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <StatusDot status={run.status} />
              <span className="truncate">{run.prompt.split("\n")[0] || "Sesión interactiva"}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={RUN_STATUS_VARIANT[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
              <Badge>{run.mode}</Badge>
              <span className="font-mono">{shortPath(run.projectPath)}</span>
              {run.agent && <span>@{run.agent}</span>}
              {run.model && <span>{run.model}</span>}
              <span>permisos: {run.permissionMode}</span>
              <span>{timeAgo(run.startedAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {run.sessionId && (
              <Button variant="outline" asChild>
                <Link href={`/sessions/${run.sessionId}`}>
                  <ExternalLinkIcon /> Ver sesión
                </Link>
              </Button>
            )}
            {run.status !== "running" && run.sessionId && (
              <Button onClick={() => launcher.open({ projectPath: run.projectPath, resumeSessionId: run.sessionId!, agent: run.agent ?? undefined })}>
                <PlayIcon /> Continuar
              </Button>
            )}
            {run.status === "running" ? (
              <Button variant="destructive" onClick={stop}>
                <SquareIcon /> Detener
              </Button>
            ) : (
              <Button variant="destructive" size="icon" onClick={remove} aria-label="Borrar ejecución">
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
        {run.error && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{run.error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <Tabs defaultValue="output">
            <TabsList>
              <TabsTrigger value="output">
                <TerminalIcon /> Salida
              </TabsTrigger>
              <TabsTrigger value="diff">
                <FileDiffIcon /> Cambios
              </TabsTrigger>
            </TabsList>
            {/* forceMount keeps the live log polling while the diff tab is open */}
            <TabsContent value="output" forceMount className="data-[state=inactive]:hidden">
              {run.mode === "tmux" ? <TmuxConsole run={run} /> : <HeadlessLog run={run} />}
            </TabsContent>
            <TabsContent value="diff">
              <RunDiffView runId={run.id} live={run.status === "running"} />
            </TabsContent>
          </Tabs>
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
              {run.prompt && <CopyButton value={run.prompt} />}
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{run.prompt || "—"}</pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Métricas</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Metric k="Coste" v={run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : "—"} />
              <Metric k="Duración" v={run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)} s` : "—"} />
              <Metric k="Turnos" v={run.numTurns != null ? String(run.numTurns) : "—"} />
              <Metric k="Código salida" v={run.exitCode != null ? String(run.exitCode) : "—"} />
            </CardContent>
          </Card>
          <UsageCard />
          {run.taskId && (
            <Button variant="outline" asChild>
              <Link href={`/tasks?task=${run.taskId}`}>Ver tarea vinculada</Link>
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-semibold tabular-nums">{v}</div>
    </div>
  );
}
