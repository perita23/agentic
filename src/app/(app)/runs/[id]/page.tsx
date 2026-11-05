"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftIcon, BotIcon, FileDiffIcon, CornerDownLeftIcon, ListPlusIcon, ExternalLinkIcon, PlayIcon, SquareIcon, TerminalIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { SlashList, useSlashCommands, useSlashMenu } from "@/components/app/slash-menu";
import { MODELS, parseSlash, type PermMode } from "@/lib/slash";
import { stateFromEvents } from "@/lib/orb-state";
import { RUN_STATUS_LABEL, RUN_STATUS_VARIANT } from "@/components/app/run-row";
import { api, fetcher, refresh, useApi, type Run, type RunLog } from "@/lib/api";
import { cn, shortPath, timeAgo } from "@/lib/utils";
import { AttachButton, AttachmentBar, useAttachments } from "@/components/app/attachments";
import { BranchSwitcher } from "@/components/app/branch-switcher";
import { FileList, useFileMenu } from "@/components/app/file-menu";
import { LiveStatus } from "@/components/app/live-status";
import { liveStats } from "@/lib/live-stats";
import { Markdown } from "@/components/app/markdown";
import { PlanCard } from "@/components/app/plan-card";
import { ToolCard, type ToolResult } from "@/components/app/tool-card";
import { EditCard, FileChangeCard } from "@/components/app/file-change";
import type { FileChange } from "@/lib/server/run-changes";
import { extractPlan } from "@/lib/plan";

type Ev = RunLog["events"][number];

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join("\n");
  return "";
}

/** The final result: typed out slowly; once written, its border and fill grow from the top-left corner. */
function ResultCard({ e, run, jira }: { e: Ev; run: Run; jira: (t: string) => React.ReactNode }) {
  const [fresh] = React.useState(() => run.status === "running" || (!!run.endedAt && Date.now() - Date.parse(run.endedAt) < 20000));
  const text = String(e.result ?? "");
  const [on, setOn] = React.useState(!fresh || !text);
  const done = React.useCallback(() => setOn(true), []);
  const tone = e.is_error ? "var(--color-destructive)" : "var(--color-success)";
  return (
    <div
      className="reveal-card rounded-md border p-3 text-sm"
      data-on={on}
      style={{ "--rc": `color-mix(in srgb, ${tone} 40%, transparent)`, "--rb": `color-mix(in srgb, ${tone} 6%, transparent)` } as React.CSSProperties}
    >
      <div className="mb-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className={e.is_error ? "text-destructive" : "text-success"}>{e.is_error ? "Error" : "Resultado"}</span>
        {typeof e.total_cost_usd === "number" && <span>${e.total_cost_usd.toFixed(4)}</span>}
        {typeof e.duration_ms === "number" && <span>{(e.duration_ms / 1000).toFixed(1)} s</span>}
        {typeof e.num_turns === "number" && <span>{e.num_turns} turnos</span>}
      </div>
      <Markdown reveal={fresh} onTyped={done}>{text}</Markdown>
      {!e.is_error && !!e.result && <div className="mt-2 flex justify-end">{jira(text)}</div>}
    </div>
  );
}

function EventView({ e, run, results, finished, paired, planId, planText, changes }: { e: Ev; run: Run; results: Map<string, ToolResult>; finished: boolean; paired: Set<string>; planId: string | null; planText: string; changes: Map<string, FileChange[]> }) {
  const jira = (text: string) => <JiraCommentButton text={text} hints={[run.prompt, run.resultText]} taskId={run.taskId} />;
  if (e.type === "agentic" && e.subtype === "start")
    return <div className="font-mono text-xs text-muted-foreground">$ {(e.args as string[]).join(" ")}</div>;
  if (e.type === "agentic" && e.subtype === "exit")
    return <div className="font-mono text-xs text-muted-foreground">— proceso terminado (código {String(e.code ?? e.signal)}) —</div>;
  if (e.type === "agentic" && e.subtype === "file_changes") return <>{((e.files ?? []) as FileChange[]).map((c) => <FileChangeCard key={c.path} change={c} />)}</>;
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
                <Markdown reveal={!finished}>{String(b.text ?? "")}</Markdown>
                <div className="mt-1 flex">{jira(String(b.text ?? ""))}</div>
              </div>
            </div>
          ) : b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim() ? (
            <details key={i} className="ml-6 rounded-lg border bg-inset text-xs">
              <summary className="cursor-pointer px-2.5 py-1.5 text-muted-foreground italic">Razonamiento</summary>
              <p className="max-h-60 overflow-auto px-3 pb-2.5 whitespace-pre-wrap text-muted-foreground italic">{b.thinking}</p>
            </details>
          ) : b.type === "tool_use" && b.name === "ExitPlanMode" && (typeof b.input?.plan === "string" || planText) ? (
            <div key={i} className="ml-6"><PlanCard plan={typeof b.input?.plan === "string" && b.input.plan ? b.input.plan : planText} run={run} actionable={planId === String(b.id) && run.status !== "running"} /></div>
          ) : b.type === "tool_use" ? (
            <React.Fragment key={i}>
              {b.name === "Edit" || b.name === "MultiEdit" || b.name === "Write" ? (
                <EditCard name={String(b.name)} input={b.input} result={results.get(String(b.id))} finished={finished} projectPath={run.projectPath} />
              ) : (
                <ToolCard name={String(b.name)} input={b.input} result={results.get(String(b.id))} finished={finished} />
              )}
              {/* Files a command changed, right under it. */}
              {(changes.get(String(b.id)) ?? []).map((c) => (
                <FileChangeCard key={c.path} change={c} />
              ))}
            </React.Fragment>
          ) : null,
        )}
      </div>
    );
  }
  if (e.type === "user") {
    const blocks: Ev[] = Array.isArray(e.message?.content) ? e.message.content : [];
    const rs = blocks.filter((b) => b.type === "tool_result" && !paired.has(String(b.tool_use_id)));
    if (!rs.length) return null;
    return (
      <div className="ml-6 flex flex-col gap-1">
        {rs.map((r, i) => (
          <details key={i} className={cn("rounded border text-xs", r.is_error ? "border-destructive/40" : "")}>
            <summary className="cursor-pointer px-2 py-1 font-mono text-muted-foreground">↳ resultado{r.is_error ? " (error)" : ""}</summary>
            <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{linkify(contentText(r.content).slice(0, 5000))}</pre>
          </details>
        ))}
      </div>
    );
  }
  if (e.type === "result") return <ResultCard e={e} run={run} jira={jira} />;
  if (e.type === "stderr") return <pre className="font-mono text-xs whitespace-pre-wrap text-destructive/80">{String(e.text)}</pre>;
  if (e.type === "stdout") return <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">{String(e.text)}</pre>;
  return null;
}

/** Events of one run: live over SSE, with incremental polling as fallback. */
function useRunEvents(runId: string) {
  const [events, setEvents] = React.useState<Ev[]>([]);
  const offset = React.useRef(0);
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
          const log = await fetcher<RunLog>(`/api/runs/${runId}/log?offset=${offset.current}`);
          more = log.nextOffset > offset.current && log.events.length > 0;
          offset.current = log.nextOffset;
          status = log.status;
          log.events.forEach(push);
        }
        if (!cancelled && status === "running") timer = setTimeout(poll, 1000);
        else refresh(`/api/runs/${runId}`);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 3000);
      }
    };

    if (typeof EventSource === "undefined") {
      void poll();
    } else {
      es = new EventSource(`/api/runs/${runId}/stream`);
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
        refresh(`/api/runs/${runId}`);
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
  }, [runId]);

  return { events, live };
}

/** One turn of the conversation: the user's message (replies) and what Claude did. */
function Segment({ run, index, latest, onEvents }: { run: Run; index: number; latest: boolean; onEvents: (id: string, events: Ev[], live: boolean) => void }) {
  const { events, live } = useRunEvents(run.id);
  React.useEffect(() => onEvents(run.id, events, live), [run.id, events, live, onEvents]);
  // Replies reuse the session: hide the repeated command line, init and exit noise.
  const shown = index === 0 ? events : events.filter((e) => !(e.type === "agentic" && (e.subtype === "start" || e.subtype === "exit")) && !(e.type === "system" && e.subtype === "init"));
  // Pair each tool call with its result (they arrive as separate events) so a call renders as one card.
  const { results, paired } = React.useMemo(() => {
    const results = new Map<string, ToolResult>();
    const used = new Set<string>();
    for (const e of events) {
      const blocks: Ev[] = e.type === "user" && Array.isArray(e.message?.content) ? e.message.content : [];
      for (const b of blocks) if (b.type === "tool_result" && b.tool_use_id) results.set(String(b.tool_use_id), { content: b.content, isError: !!b.is_error });
    }
    for (const e of events) {
      const blocks: Ev[] = e.type === "assistant" && Array.isArray(e.message?.content) ? e.message.content : [];
      for (const b of blocks) if (b.type === "tool_use" && b.id) used.add(String(b.id));
    }
    return { results, paired: new Set([...results.keys()].filter((k) => used.has(k))) };
  }, [events]);
  const finished = run.status !== "running";
  // Changes found in the working tree after a command hang under that command's card, in place.
  const { changes, inline } = React.useMemo(() => {
    const toolIds = new Set<string>();
    for (const e of events) {
      const blocks: Ev[] = e.type === "assistant" && Array.isArray(e.message?.content) ? e.message.content : [];
      for (const b of blocks) if (b.type === "tool_use" && b.id) toolIds.add(String(b.id));
    }
    const changes = new Map<string, FileChange[]>();
    const inline = new Set<Ev>();
    for (const e of events) {
      if (e.type === "agentic" && e.subtype === "file_changes" && typeof e.after === "string" && toolIds.has(e.after)) {
        changes.set(e.after, [...(changes.get(e.after) ?? []), ...((e.files ?? []) as FileChange[])]);
        inline.add(e);
      }
    }
    return { changes, inline };
  }, [events]);
  // The plan of this turn (from ExitPlanMode or from the plan file Claude wrote). Only the latest turn's can be answered.
  const found = React.useMemo(() => extractPlan(events), [events]);
  const planId = latest ? (found?.id ?? null) : null;
  const planText = found?.plan ?? "";
  return (
    <>
      {index > 0 && (
        <div className="flex justify-end">
          <div className="grid max-w-[85%] gap-2 rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm">
            {run.images?.length ? (
              <div className="flex flex-wrap gap-2">
                {run.images.map((id) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={id} href={`/api/uploads/${id}`} target="_blank" rel="noreferrer"><img src={`/api/uploads/${id}`} alt="Imagen adjunta" className="max-h-40 rounded-md border object-cover" /></a>
                ))}
              </div>
            ) : null}
            <div className="max-h-72 overflow-auto break-words whitespace-pre-wrap">{linkify(run.prompt)}</div>
          </div>
        </div>
      )}
      {shown.filter((e) => !inline.has(e)).map((e, i) => (
        <EventView key={i} e={e} run={run} results={results} finished={finished} paired={paired} planId={planId} planText={planText} changes={changes} />
      ))}
      {/* Plan written to a plan file without calling ExitPlanMode: still offer it as a plan. */}
      {found && found.id === null && (
        <div className="ml-6">
          <PlanCard plan={found.plan} run={run} actionable={latest && finished} />
        </div>
      )}
    </>
  );
}

/** The whole conversation (first run + replies) in one place, like the chat. */
function HeadlessLog({ thread }: { thread: Run[] }) {
  const run = thread[thread.length - 1];
  const [byRun, setByRun] = React.useState<Record<string, { events: Ev[]; live: boolean }>>({});
  const onEvents = React.useCallback(
    (id: string, events: Ev[], live: boolean) => setByRun((p) => (p[id]?.events === events && p[id]?.live === live ? p : { ...p, [id]: { events, live } })),
    [],
  );
  const scroller = React.useRef<HTMLDivElement>(null);
  const [follow, setFollow] = React.useState(true);
  const live = thread.some((r) => byRun[r.id]?.live);
  const latestEvents = byRun[run.id]?.events;
  const stats = React.useMemo(() => liveStats(latestEvents ?? []), [latestEvents]);

  React.useEffect(() => {
    // Scroll only the log container, never the whole window.
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [byRun, thread.length, follow]);

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
      <CardContent ref={scroller} className="max-h-[65vh] min-h-64 overflow-y-auto bg-inset p-4">
        <div className="flex flex-col gap-3">
          {thread.map((r, i) => (
            <Segment key={r.id} run={r} index={i} latest={i === thread.length - 1} onEvents={onEvents} />
          ))}
          {/* At the end of the output: what Claude is doing now (step, time, tokens) while it works, a calm orb when done. */}
          {run.status === "running" ? (
            <LiveStatus activity={stateFromEvents(byRun[run.id]?.events ?? [])} stats={stats} startedAt={run.startedAt} />
          ) : (
            <ActivityOrb activity={run.status === "failed" ? { state: "error", label: "Ha fallado" } : stateFromEvents(byRun[run.id]?.events ?? [])} size={44} className="mt-1" />
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
  const [text, setText] = React.useState("");
  const [mode, setMode] = React.useState<string>(run.permissionMode || "default");
  const [model, setModel] = React.useState<string>(run.model || "");
  const [busy, setBusy] = React.useState(false);
  const commands = useSlashCommands(run.projectPath);
  const menu = useSlashMenu(text, setText, commands);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const files = useFileMenu(text, setText, boxRef, run.projectPath);
  const att = useAttachments();
  const [drag, setDrag] = React.useState(false);
  const waiting = run.status === "running";
  const { data: queued, mutate: refetchQueue } = useApi<{ queue: { id: string; prompt: string; images?: string[] }[] }>(run.mode === "headless" ? `/api/runs/${run.id}/queue` : null, { refreshInterval: waiting ? 2500 : 0 });
  if (run.mode !== "headless") return null;
  const noSession = !run.sessionId;
  const queue = queued?.queue ?? [];

  async function stop() {
    try {
      await api("POST", `/api/runs/${run.id}/stop`);
      refresh("/api/runs", "/api/overview");
      toast.success("Detenido", { description: queue.length ? "La cola queda en pausa: tú decides qué enviar." : undefined });
    } catch (err) {
      toast.error("No se pudo detener", { description: errorMessage(err) });
    }
  }
  async function dropQueued(id: string) {
    await api("DELETE", `/api/runs/${run.id}/queue/${id}`);
    void refetchQueue();
  }
  async function sendQueuedNow() {
    try {
      await api("PUT", `/api/runs/${run.id}/queue`);
      refresh("/api/runs", "/api/overview");
      void refetchQueue();
    } catch (err) {
      toast.error("No se pudo enviar", { description: errorMessage(err) });
    }
  }

  async function send(e?: React.SyntheticEvent) {
    e?.preventDefault();
    if ((!text.trim() && !att.any) || (noSession && !waiting) || att.uploading) return;
    const cmd = parseSlash(text);
    if (cmd.error) {
      toast.error(cmd.error);
      return;
    }
    const nextMode = cmd.mode ?? (mode as PermMode);
    const nextModel = cmd.model ?? model;
    if (cmd.mode) setMode(cmd.mode);
    if (cmd.model) setModel(cmd.model);
    if (!cmd.prompt && !att.any) {
      // Only switched mode/model: nothing to send yet.
      toast.success(`Ajustado: ${cmd.applied.join(" · ")}`, { description: "Se aplica a tu próximo mensaje." });
      setText("");
      return;
    }
    setBusy(true);
    try {
      if (waiting) {
        // Claude is working: the message waits in line and goes out when this turn finishes.
        const r = await api<{ started?: Run; queue: unknown[] }>("POST", `/api/runs/${run.id}/queue`, {
          prompt: att.withPastes(cmd.prompt) || "Mira lo que te adjunto.",
          images: att.imageIds.length ? att.imageIds : undefined,
          permissionMode: nextMode,
          model: nextModel || undefined,
        });
        setText("");
        att.clear();
        void refetchQueue();
        refresh("/api/runs", "/api/overview");
        toast.success(r.started ? "Enviado" : `En cola (${r.queue.length})`, { description: r.started ? undefined : "Saldrá en cuanto Claude termine." });
        return;
      }
      await api<Run>("POST", "/api/runs", {
        mode: "headless",
        projectPath: run.projectPath,
        prompt: att.withPastes(cmd.prompt) || "Mira lo que te adjunto.",
        images: att.imageIds.length ? att.imageIds : undefined,
        continueRunId: run.id,
        permissionMode: nextMode,
        model: nextModel || undefined,
      });
      setText("");
      att.clear();
      // The reply shows up below, in this same conversation.
      refresh("/api/runs", "/api/overview");
    } catch (err) {
      toast.error("No se pudo enviar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  // While Claude works you can still write: the message is queued. Only a conversation without a session is closed.
  const off = noSession && !waiting;
  return (
    <form
      onSubmit={send}
      onDragOver={(e) => { if (!off && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { setDrag(false); if (off || !e.dataTransfer.files.length) return; e.preventDefault(); void att.addFiles([...e.dataTransfer.files]); }}
      className={cn("grid gap-2 border-t bg-card p-3 transition-colors", drag && "bg-accent/40 outline-2 -outline-offset-4 outline-dashed outline-primary/60")}
    >
      {queue.length > 0 && (
        <div className="grid gap-1.5 rounded-lg border bg-inset p-2.5 text-xs" aria-label="Mensajes en cola">
          <div className="flex items-center gap-2 font-medium">
            <ListPlusIcon className="size-3.5 text-muted-foreground" />
            {waiting ? `En cola (${queue.length}) · se envían uno a uno al terminar` : `Cola en pausa (${queue.length}) · Claude no está trabajando`}
            {!waiting && (
              <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={() => void sendQueuedNow()}>
                Enviar ahora
              </Button>
            )}
          </div>
          <ol className="grid gap-1">
            {queue.map((q, n) => (
              <li key={q.id} className="flex min-w-0 items-start gap-2 rounded-md bg-card px-2 py-1">
                <span className="mt-px shrink-0 tabular-nums text-muted-foreground">{n + 1}.</span>
                <span className="line-clamp-2 min-w-0 flex-1 break-words">{q.prompt}{q.images?.length ? ` · ${q.images.length} imagen${q.images.length === 1 ? "" : "es"}` : ""}</span>
                <button type="button" aria-label={`Quitar de la cola: ${q.prompt.slice(0, 40)}`} onClick={() => void dropQueued(q.id)} className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive">
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <AttachmentBar att={att} disabled={off} />
      <div className="relative">
        {menu.open && <SlashList items={menu.items} active={menu.active} onPick={menu.pick} />}
        {files.open && <FileList items={files.items} active={files.active} onPick={files.pick} />}
        <textarea
          ref={boxRef}
          aria-label="Responder a Claude"
          rows={5}
          value={text}
          disabled={off}
          onChange={(e) => {
            setText(e.target.value);
            files.track(e.currentTarget);
          }}
          onSelect={(e) => files.track(e.currentTarget)}
          onPaste={(e) => { if (!off) att.onPaste(e); }}
          onKeyDown={(e) => {
            if (files.onKeyDown(e)) return;
            if (menu.onKeyDown(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e);
          }}
          placeholder={waiting ? "Claude está trabajando. Escribe y tu mensaje se enviará en cuanto termine (puedes dejar varios en cola)." : noSession ? "Esta ejecución no tiene sesión que continuar." : "Responde a Claude. Escribe / para comandos y @ para archivos, o pega o arrastra imágenes y textos largos."}
          className="min-h-32 w-full resize-y rounded-md border bg-inset p-3 text-sm disabled:opacity-60"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AttachButton att={att} disabled={off} />
        <BranchSwitcher project={run.projectPath} disabled={waiting} disabledReason="Claude está trabajando: espera a que termine para cambiar de rama" />
        <select aria-label="Permisos" value={mode} onChange={(e) => setMode(e.target.value)} className="h-8 rounded-md border bg-inset px-2 text-xs" disabled={off}>
          <option value="default">Permisos: preguntar</option>
          <option value="plan">Permisos: sólo planificar</option>
          <option value="acceptEdits">Permisos: aceptar ediciones</option>
          <option value="auto">Permisos: auto</option>
        </select>
        <select aria-label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} className="h-8 rounded-md border bg-inset px-2 text-xs" disabled={off}>
          <option value="">Modelo: por defecto</option>
          {MODELS.map((m) => (
            <option key={m} value={m}>
              Modelo: {m}
            </option>
          ))}
        </select>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl/⌘ + Enter para {waiting ? "dejarlo en cola" : "enviar"}</span>
        <div className="ml-auto flex items-center gap-2">
          {waiting && (
            <Button type="button" size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void stop()}>
              <SquareIcon /> Detener
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy || off || att.uploading || (!text.trim() && !att.any)}>
            {waiting ? <ListPlusIcon /> : <CornerDownLeftIcon />} {busy ? "Enviando…" : waiting ? "Añadir a la cola" : "Enviar"}
          </Button>
        </div>
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
  const { data: self, error } = useApi<Run>(`/api/runs/${id}`, { refreshInterval: (r) => (r?.status === "running" ? 2000 : 0) });
  const { data: all } = useApi<{ runs: Run[] }>("/api/runs", { refreshInterval: (d) => (d?.runs.some((r) => r.status === "running") ? 2000 : 0) });

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!self) return <Skeleton className="h-64" />;
  // The conversation: the first run and its replies. `run` is the latest turn, `root` the first.
  const key = self.threadId ?? self.id;
  const found = (all?.runs ?? []).filter((r) => (r.threadId ?? r.id) === key).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const thread = found.length ? found : [self];
  const root = thread[0];
  const run = thread[thread.length - 1];
  const sum = (f: (r: Run) => number | null) => (thread.some((r) => f(r) != null) ? thread.reduce((a, r) => a + (f(r) ?? 0), 0) : null);
  const cost = sum((r) => r.costUsd);
  const duration = sum((r) => r.durationMs);
  const turns = sum((r) => r.numTurns);

  async function stop() {
    try {
      await api("POST", `/api/runs/${run.id}/stop`);
      toast.success("Ejecución detenida");
      refresh("/api/runs", "/api/overview");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function remove() {
    if (!confirm(thread.length > 1 ? `¿Borrar esta conversación (${thread.length} mensajes) y sus logs?` : "¿Borrar esta ejecución y su log?")) return;
    try {
      for (const r of thread) await api("DELETE", `/api/runs/${r.id}`);
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
              <span className="truncate">{root.prompt.split("\n")[0] || "Sesión interactiva"}</span>
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
              {run.mode === "tmux" ? <TmuxConsole run={run} /> : <HeadlessLog thread={thread} />}
            </TabsContent>
            <TabsContent value="diff">
              <RunDiffView runId={root.id} live={run.status === "running"} />
            </TabsContent>
          </Tabs>
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
              {root.prompt && <CopyButton value={root.prompt} />}
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{root.prompt || "—"}</pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Métricas</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Metric k="Coste" v={cost != null ? `$${cost.toFixed(4)}` : "—"} />
              <Metric k="Duración" v={duration != null ? `${(duration / 1000).toFixed(1)} s` : "—"} />
              <Metric k="Turnos" v={turns != null ? String(turns) : "—"} />
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
