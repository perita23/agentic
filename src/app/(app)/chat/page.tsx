"use client";

import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, BookOpenIcon, CheckIcon, CodeIcon, CopyIcon, DownloadIcon, FileIcon, ListChecksIcon, ListPlusIcon, NetworkIcon, Loader2Icon, MessageSquarePlusIcon, PencilIcon, PinIcon, RegexIcon, SearchIcon, SparklesIcon, SquareIcon, Trash2Icon, WrenchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/app/markdown";
import { CyclingOrb, LiquidOrb } from "@/components/app/liquid-orb";
import { LiveStatus } from "@/components/app/live-status";
import { Appear } from "@/components/app/appear";
import { isSubagentTool, SubagentChips } from "@/components/app/subagent-card";
import { AssistChip, ImproveButton, usePromptAssist, WordMorphs } from "@/components/app/prompt-assist";
import { AnimatePresence, ReadAloudButton, useSpeaker, VoiceLoop, VoiceModeButton, VoiceStage } from "@/components/app/speak";
import { VoiceButton, VoiceInline } from "@/components/app/voice";
import { replaceAll } from "@/lib/voice/insert";
import { speaker } from "@/lib/voice/speak";
import { useStickToBottom } from "@/lib/use-stick-bottom";
import type { LiveStats } from "@/lib/live-stats";
import { SlashList, useSlashCommands, useSlashMenu } from "@/components/app/slash-menu";
import { MODE_LABEL, parseSlash, type PermMode } from "@/lib/slash";
import { describeTool } from "@/lib/tool-cards";
import type { Activity } from "@/lib/orb-state";
import { errorMessage, PageHeader } from "@/components/app/common";
import { api, refresh, useApi } from "@/lib/api";
import { cn, formatBytes, timeAgo } from "@/lib/utils";

interface ChatItem {
  id: string;
  title: string;
  model: string | null;
  updatedAt: string;
  pinned?: boolean;
  running: boolean;
  activity?: Activity | null;
  live?: (LiveStats & { startedAt: string }) | null;
}
interface ChatFile {
  path: string;
  name: string;
  size: number;
}
interface ChatMessage {
  role: "user" | "assistant";
  /** Files Claude created while writing this message (to download). */
  files?: ChatFile[];
  text: string;
  tools?: { name: string; input: string }[];
  timestamp?: string;
}
interface ChatDetail extends ChatItem {
  lastRunId: string | null;
  messages: ChatMessage[];
  pendingPrompt: string | null;
  error: string | null;
}

const MODELS = [
  { value: "", label: "Modelo por defecto" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];
const SUGGESTIONS = [
  { icon: BookOpenIcon, text: "Explícame la diferencia entre rebase y merge" },
  { icon: CodeIcon, text: "Escribe un script que renombre fotos por fecha" },
  { icon: RegexIcon, text: "Revisa esta expresión regular y explícamela" },
  { icon: ListChecksIcon, text: "Ayúdame a planificar una migración a TypeScript" },
];

function toolLabel(t: { name: string; input: string }) {
  let input: unknown = null;
  try {
    input = JSON.parse(t.input);
  } catch {}
  const info = describeTool(t.name, input);
  return { group: info.group, title: info.title };
}

/** The files Claude created: each one with its own download button. */
function FileCards({ chatId, files }: { chatId: string; files: ChatFile[] }) {
  return (
    <div data-testid="chat-files" className="mt-3 grid gap-2 sm:grid-cols-2">
      {files.map((f) => (
        <div key={f.path} className="appear flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-inset text-muted-foreground">
            <FileIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={f.path}>
              {f.name}
            </div>
            <div className="text-xs text-muted-foreground">{formatBytes(f.size)}</div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <a href={`/api/chats/${chatId}/file?path=${encodeURIComponent(f.path)}`} download={f.name} aria-label={`Descargar ${f.name}`}>
              <DownloadIcon /> Descargar
            </a>
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Copies a message's text; the icon says it worked. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("size-7 rounded-full text-muted-foreground", className)}
      aria-label="Copiar"
      title="Copiar"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          toast.error("No se pudo copiar");
        }
      }}
    >
      {done ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </Button>
  );
}

/** Puts a sent message back in the box to change it and send it again. */
function editInBox(text: string) {
  const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Mensaje para Claude']");
  if (box) replaceAll(box, text);
}

/** The user's message on the right; Claude's answer as plain Markdown across the column (no avatar clutter). */
function BubbleImpl({ m, reveal, chatId }: { m: ChatMessage; reveal?: boolean; chatId?: string }) {
  if (m.role === "user")
    return (
      <div className="group flex items-end justify-end gap-1">
        <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={m.text} />
          <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-full text-muted-foreground" aria-label="Editar y reenviar" title="Editar y reenviar" onClick={() => editInBox(m.text)}>
            <PencilIcon className="size-3.5" />
          </Button>
        </div>
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm break-words whitespace-pre-wrap">{m.text}</div>
      </div>
    );
  return (
    <div className="min-w-0">
      {m.tools && m.tools.some((t) => isSubagentTool(t.name)) && <SubagentChips tools={m.tools} />}
      {m.tools && m.tools.some((t) => !isSubagentTool(t.name)) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {m.tools.filter((t) => !isSubagentTool(t.name)).map((t, i) => {
            const l = toolLabel(t);
            const gf = l.group.startsWith("Graphify");
            return (
              <span key={i} data-graphify={gf ? "" : undefined} className={cn("flex max-w-full items-center gap-1.5 rounded-md border bg-inset px-2 py-0.5 text-[11px] text-muted-foreground", gf && "border-purple/40 bg-purple/10")} title={t.input}>
                {gf ? <NetworkIcon className="size-3 shrink-0 text-purple" /> : <WrenchIcon className="size-3 shrink-0" />} <span className="shrink-0 font-medium text-foreground/80">{l.group}</span>
                {l.title && <span className="truncate font-mono">{l.title}</span>}
              </span>
            );
          })}
        </div>
      )}
      {m.text.trim() && <Markdown reveal={reveal}>{m.text}</Markdown>}
      {chatId && m.files && m.files.length > 0 && <FileCards chatId={chatId} files={m.files} />}
      {m.text.trim() && (
        <div className="-ml-1.5 mt-1 flex opacity-50 transition-opacity focus-within:opacity-100 hover:opacity-100">
          <CopyButton text={m.text} />
          <ReadAloudButton text={m.text} />
        </div>
      )}
    </div>
  );
}

/** The poll brings new message objects every 700 ms: a bubble is drawn again only if what it shows changed. */
const Bubble = React.memo(BubbleImpl, (a, b) => a.reveal === b.reveal && a.m.role === b.m.role && a.m.text === b.m.text && (a.m.tools?.length ?? 0) === (b.m.tools?.length ?? 0) && a.chatId === b.chatId && (a.m.files ?? []).map((f) => `${f.path}:${f.size}`).join() === (b.m.files ?? []).map((f) => `${f.path}:${f.size}`).join());

/** The conversation's scrolling area: it always follows the end (orb and status included) until you scroll up. */
function ChatScroll({ children }: { children: React.ReactNode }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const { stuck, scrollToEnd } = useStickToBottom(scroller, body);
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} tabIndex={0} aria-label="Conversación" className="h-full overflow-y-auto outline-none">
        <div ref={body} className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6">
          {children}
        </div>
      </div>
      {!stuck && (
        <button
          type="button"
          onClick={scrollToEnd}
          className="appear absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur hover:bg-card"
        >
          <ArrowDownIcon className="size-3.5" /> Ir al final
        </button>
      )}
    </div>
  );
}

type SendOpts = { model?: string; mode?: PermMode };

function Composer({ onSend, busy, running, onStop, lastSent, autoFocus, model, setModel, mode, setMode }: { onSend: (t: string, o: SendOpts) => Promise<boolean>; busy: boolean; running?: boolean; onStop?: () => void; lastSent?: string; autoFocus?: boolean; model: string; setModel: (m: string) => void; mode: PermMode; setMode: (m: PermMode) => void }) {
  const [text, setText] = React.useState("");
  const commands = useSlashCommands(null);
  const menu = useSlashMenu(text, setText, commands);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const assist = usePromptAssist(text, () => boxRef.current);
  // One message can wait while Claude is still answering: it is sent the moment it finishes.
  const [queued, setQueued] = React.useState<string | null>(null);
  const queuedRef = React.useRef<string | null>(null);
  const sendRef = React.useRef(onSend);
  React.useEffect(() => {
    sendRef.current = onSend;
  });
  React.useEffect(() => {
    if (busy || queuedRef.current === null) return;
    const q = queuedRef.current;
    queuedRef.current = null;
    void sendRef.current(q, {}).then(() => setQueued(null));
  }, [busy]);
  async function send() {
    const t = text.trim();
    if (!t) return;
    if (busy) {
      if (t.startsWith("/")) return toast.message("Los comandos / se envían cuando Claude termine");
      queuedRef.current = t;
      setQueued(t);
      setText("");
      return;
    }
    // /plan, /edits, /ask, /auto and /model are handled here; other /commands go to Claude Code.
    const cmd = parseSlash(t);
    if (cmd.error) {
      toast.error(cmd.error);
      return;
    }
    if (cmd.mode) setMode(cmd.mode);
    if (cmd.model) setModel(cmd.model);
    if (!cmd.prompt) {
      toast.success(`Ajustado: ${cmd.applied.join(" · ")}`, { description: "Se aplica a tus próximos mensajes." });
      setText("");
      return;
    }
    if (await onSend(cmd.prompt, { model: cmd.model, mode: cmd.mode })) setText("");
  }
  return (
    <div data-composer className="relative rounded-xl border bg-card transition-colors focus-within:border-border-strong">
      {menu.open && <SlashList items={menu.items} active={menu.active} onPick={menu.pick} className="mx-2" />}
      <Textarea
        ref={boxRef}
        autoFocus={autoFocus}
        rows={2}
        value={text}
        placeholder="Escribe a Claude… (/ para comandos: /plan, /model…)"
        aria-label="Mensaje para Claude"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (menu.onKeyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
          // ↑ in an empty box brings back what you sent last (to fix it or send it again).
          if (e.key === "ArrowUp" && !text && lastSent) {
            e.preventDefault();
            setText(lastSent);
          }
        }}
        className="max-h-60 min-h-14 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
      />
      {queued && (
        <div data-testid="queued" className="flex min-w-0 items-center gap-2 px-4 pb-1 text-xs text-muted-foreground">
          <ListPlusIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">En cola, se envía al terminar: {queued}</span>
          <button
            type="button"
            aria-label="Quitar el mensaje en cola"
            className="shrink-0 cursor-pointer rounded px-1 hover:bg-accent hover:text-foreground"
            onClick={() => {
              queuedRef.current = null;
              setText(queued);
              setQueued(null);
            }}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      <AssistChip a={assist} />
      <WordMorphs a={assist} />
      <VoiceInline />
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex items-center gap-2">
          <select aria-label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} className="h-7 rounded-md border bg-card px-2 text-xs text-muted-foreground">
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select aria-label="Permisos" value={mode} onChange={(e) => setMode(e.target.value as PermMode)} className="h-7 rounded-md border bg-card px-2 text-xs text-muted-foreground">
            {(Object.keys(MODE_LABEL) as PermMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <ImproveButton a={assist} />
          <VoiceModeButton />
          <VoiceButton />
          {running && (
            <Button type="button" size="icon-sm" variant="outline" className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onStop} aria-label="Detener" title="Detener la respuesta (Esc)">
              <SquareIcon />
            </Button>
          )}
          <Button size="icon-sm" className="rounded-full" onClick={send} disabled={!text.trim()} aria-label={busy ? "Añadir a la cola" : "Enviar"} title={busy ? "Se enviará cuando Claude termine" : "Enviar"}>
            {busy ? <ListPlusIcon /> : <ArrowUpIcon />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { data: list } = useApi<{ chats: ChatItem[] }>("/api/chats", { refreshInterval: 5000 });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [model, setModel] = React.useState("");
  const [mode, setMode] = React.useState<PermMode>("default");
  const [sending, setSending] = React.useState(false);
  // Shown the instant you send, before the server answers (the conversation feels immediate).
  const [optimistic, setOptimistic] = React.useState<string | null>(null);
  const { data: chat } = useApi<ChatDetail>(selected ? `/api/chats/${selected}` : null, { refreshInterval: (d) => (d?.running ? (speaker.state.voiceMode ? 350 : 700) : 0) });
  // The optimistic bubble only stands in until the server shows the same message.
  const optimisticShown = optimistic && !chat?.pendingPrompt && !chat?.messages.some((m) => m.role === "user" && m.text.trim() === optimistic.trim()) ? optimistic : null;

  async function newChat(prompt: string, o: SendOpts = {}) {
    setSending(true);
    setOptimistic(prompt);
    try {
      const c = await api<ChatItem>("POST", "/api/chats", { prompt, model: o.model ?? model, permissionMode: o.mode ?? mode, voice: speaker.state.voiceMode });
      setSelected(c.id);
      refresh("/api/chats");
      return true;
    } catch (e) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
      setOptimistic(null);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function reply(prompt: string, o: SendOpts = {}) {
    if (!selected) return newChat(prompt, o);
    setSending(true);
    setOptimistic(prompt);
    try {
      await api("POST", `/api/chats/${selected}/messages`, { prompt, model: o.model ?? model, permissionMode: o.mode ?? mode, voice: speaker.state.voiceMode });
      refresh(`/api/chats/${selected}`, "/api/chats");
      return true;
    } catch (e) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
      setOptimistic(null);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function stopChat() {
    if (!chat?.lastRunId) return;
    try {
      await api("POST", `/api/runs/${chat.lastRunId}/stop`);
      refresh(`/api/chats/${selected}`, "/api/chats");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  const lastSent = [...(chat?.messages ?? [])].reverse().find((m) => m.role === "user")?.text ?? "";
  const talk = useSpeaker();
  // The answer of the turn as the transcript has it (when the stream did not show it).
  const msgs = chat?.messages ?? [];
  const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
  const turnAnswer = msgs
    .slice(lastUser + 1)
    .filter((m) => m.role === "assistant" && m.text.trim())
    .map((m) => m.text)
    .join("\n");

  async function remove(id: string) {
    if (!confirm("¿Borrar esta conversación del historial?")) return;
    await api("DELETE", `/api/chats/${id}`);
    if (selected === id) setSelected(null);
    refresh("/api/chats");
  }

  async function togglePin(c: ChatItem) {
    await api("PATCH", `/api/chats/${c.id}`, { pinned: !c.pinned });
    refresh("/api/chats");
  }

  const q = filter.trim().toLowerCase();
  const shown = (list?.chats ?? []).filter((c) => c.title.toLowerCase().includes(q));

  return (
    <div className="flex flex-col gap-4">
      <VoiceLoop running={!!chat?.running} answer={chat?.live?.answer ?? ""} fallback={turnAnswer} />
      <AnimatePresence>{talk.voiceMode && <VoiceStage key="stage" activity={chat?.activity} busy={sending || !!chat?.running} />}</AnimatePresence>
      <PageHeader
        icon={SparklesIcon}
        title="Chat"
        description="Habla con Claude sin elegir proyecto. Tus conversaciones se guardan en tu dispositivo."
        actions={
          <Button variant="outline" onClick={() => setSelected(null)}>
            <MessageSquarePlusIcon /> Nuevo chat
          </Button>
        }
      />
      <div className="grid h-[calc(100vh-13rem)] min-h-[480px] min-w-0 grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <nav className="hidden min-h-0 flex-col md:flex" aria-label="Historial de chats">
          <div className="relative mb-2">
            <SearchIcon className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar chats"
              aria-label="Buscar chats"
              className="h-9 w-full rounded-md border bg-inset pr-2 pl-8 text-sm outline-none focus:border-border-strong"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-1.5">
            {!list && <Skeleton className="m-1 h-40" />}
            {list && !shown.length && <p className="p-3 text-center text-xs text-muted-foreground">{q ? "Sin resultados." : "Aún no hay conversaciones."}</p>}
            {shown.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group relative flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  c.id === selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {c.id === selected && <span className="absolute top-1.5 bottom-1.5 -left-1 w-0.5 rounded-full bg-foreground" />}
                <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => setSelected(c.id)}>
                  <span className="flex items-center gap-1.5">
                    {c.pinned && <PinIcon className="size-3 shrink-0" />}
                    {c.running && <Loader2Icon className="size-3 shrink-0 animate-spin" />}
                    <span className="truncate">{c.title}</span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                </button>
                <span className="hidden items-center group-hover:flex">
                  <Button size="icon-sm" variant="ghost" aria-label={c.pinned ? "Desfijar" : "Fijar"} onClick={() => togglePin(c)}>
                    <PinIcon />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Borrar" className="hover:text-destructive" onClick={() => remove(c.id)}>
                    <Trash2Icon />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </nav>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6">
              {/* The orb walks through all its states, a new one every two or three seconds. */}
              <CyclingOrb size={120} />
              <h2 className="text-xl font-semibold tracking-tight">¿En qué te ayudo?</h2>
              <div className={cn("w-full max-w-2xl", talk.voiceMode && "sr-only")}>
                <Composer onSend={newChat} busy={sending} lastSent={lastSent} autoFocus model={model} setModel={setModel} mode={mode} setMode={setMode} />
              </div>
              <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} onClick={() => newChat(s.text)} disabled={sending} className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-inset px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-60">
                    <s.icon className="mt-0.5 size-4 shrink-0" /> {s.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <span className="truncate text-sm font-semibold">{chat?.title ?? "…"}</span>
                {chat?.model && <span className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{chat.model}</span>}
              </div>
              <ChatScroll key={selected ?? "new"}>
                  {!chat && <Skeleton className="h-40" />}
                  {chat?.messages.map((m, i) => (
                    <Appear key={i} live={!!chat.running}><Bubble m={m} reveal={i === chat.messages.length - 1} chatId={chat.id} /></Appear>
                  ))}
                  {(chat?.pendingPrompt ?? optimisticShown) && <Appear><Bubble m={{ role: "user", text: (chat?.pendingPrompt ?? optimisticShown)! }} /></Appear>}
                  {/* The orb closes the conversation: step, time and tokens while Claude works (with the answer's skeleton), calm when done. */}
                  {chat?.running || optimisticShown ? (
                    <Appear><LiveStatus activity={chat?.activity ?? { state: "thinking", label: "Pensando…" }} stats={chat?.live} startedAt={chat?.live?.startedAt} /></Appear>
                  ) : chat && chat.messages.length > 0 ? (
                    <LiquidOrb state={chat.error ? "error" : "done"} size={32} />
                  ) : null}
                  {chat?.error && !chat.running && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{chat.error}</p>}
              </ChatScroll>
              <div className={cn("mx-auto w-full max-w-3xl shrink-0 px-4 pb-4", talk.voiceMode && "sr-only")}>
                <Composer onSend={reply} busy={sending || !!chat?.running} running={!!chat?.running} onStop={stopChat} lastSent={lastSent} model={model} setModel={setModel} mode={mode} setMode={setMode} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
