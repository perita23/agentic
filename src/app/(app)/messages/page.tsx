"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpIcon, HashIcon, ListTodoIcon, LockIcon, MessageSquareReplyIcon, MessagesSquareIcon, PaperclipIcon, SearchIcon, UsersIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { ProviderIcon } from "@/components/app/provider-icon";
import { api, refresh, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Channel {
  id: string;
  name: string;
  kind?: "channel" | "dm" | "group";
  isPrivate: boolean;
  isMember: boolean;
  topic: string;
}
interface Message {
  ts: string;
  threadTs: string | null;
  replyCount: number;
  author: string;
  text: string;
  files: string[];
}

/** Slack markup → readable plain text (links, specials). Rendered as text, never HTML. */
function plain(t: string) {
  return t
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const time = (ts: string) => new Date(Number(ts) * 1000).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Initials on a gradient derived from the name: every person keeps their colour. */
function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const h = hue(name);
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-black/80 uppercase", size === "sm" ? "size-6 text-[10px]" : "size-9 text-xs")}
      style={{ background: `linear-gradient(135deg, hsl(${h} 80% 78%), hsl(${(h + 50) % 360} 75% 62%))` }}
    >
      {initials || "?"}
    </span>
  );
}

function ChannelGlyph({ c, className }: { c?: Channel; className?: string }) {
  if (!c) return <HashIcon className={className} />;
  if (c.kind === "dm") return <Avatar name={c.name} size="sm" />;
  if (c.kind === "group") return <UsersIcon className={className} />;
  return c.isPrivate ? <LockIcon className={className} /> : <HashIcon className={className} />;
}

const dayLabel = (ts: string) => {
  const d = new Date(Number(ts) * 1000);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === y.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};
const hour = (ts: string) => new Date(Number(ts) * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

async function toTask(m: Message, where: string, openBoard: () => void) {
  const firstLine = plain(m.text).split("\n")[0].trim() || "Mensaje de Slack";
  try {
    await api("POST", "/api/tasks", {
      title: firstLine.slice(0, 120),
      description: `De ${m.author} en ${where} (${time(m.ts)}):\n\n${plain(m.text)}`,
      status: "backlog",
      labels: ["slack"],
    });
    toast.success("Tarea creada en el backlog", {
      description: firstLine.slice(0, 80),
      action: { label: "Ver tablero", onClick: openBoard },
    });
    refresh("/api/tasks", "/api/overview");
  } catch (e) {
    toast.error("No se pudo crear la tarea", { description: errorMessage(e) });
  }
}

function MessageItem({ m, compact, where, onThread }: { m: Message; compact?: boolean; where: string; onThread?: () => void }) {
  const router = useRouter();
  return (
    <div className={cn("group relative flex gap-3 rounded-lg px-3 hover:bg-accent/40", compact ? "py-0.5" : "mt-2 pt-2 pb-0.5")}>
      {compact ? (
        <span className="w-9 shrink-0 pt-0.5 text-right font-mono text-[10px] text-transparent group-hover:text-muted-foreground">{hour(m.ts)}</span>
      ) : (
        <Avatar name={m.author} />
      )}
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{m.author}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{hour(m.ts)}</span>
          </div>
        )}
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">{plain(m.text)}</div>
        {m.files.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {m.files.map((f) => (
              <span key={f} className="flex items-center gap-1 rounded-md border bg-inset px-2 py-0.5">
                <PaperclipIcon className="size-3" /> {f}
              </span>
            ))}
          </div>
        )}
        {onThread && m.replyCount > 0 && (
          <button onClick={onThread} className="mt-1.5 flex cursor-pointer items-center gap-1.5 rounded-md border bg-inset px-2 py-0.5 text-xs text-link hover:border-border-strong">
            <MessageSquareReplyIcon className="size-3.5" /> {m.replyCount} respuesta{m.replyCount > 1 ? "s" : ""}
          </button>
        )}
      </div>
      <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-lg shadow-black/40 group-focus-within:flex group-hover:flex">
        {onThread && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onThread}>
            <MessageSquareReplyIcon /> Responder en hilo
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toTask(m, where, () => router.push("/tasks"))}>
          <ListTodoIcon /> Crear tarea
        </Button>
      </div>
    </div>
  );
}

/** Messages with day separators; consecutive messages of one author within 5 min are grouped. */
function MessageList({ messages, where, onThread }: { messages: Message[]; where: string; onThread?: (m: Message) => void }) {
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || dayLabel(prev.ts) !== dayLabel(m.ts);
        const compact = !!prev && !newDay && prev.author === m.author && Number(m.ts) - Number(prev.ts) < 300;
        return (
          <React.Fragment key={m.ts}>
            {newDay && (
              <div className="sticky top-0 z-10 my-2 flex items-center gap-3 px-3 py-1 backdrop-blur-sm">
                <span className="h-px flex-1 bg-border" />
                <span className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground first-letter:uppercase">{dayLabel(m.ts)}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <MessageItem m={m} compact={compact} where={where} onThread={onThread ? () => onThread(m) : undefined} />
          </React.Fragment>
        );
      })}
    </>
  );
}

function Composer({ channel, threadTs, placeholder, onSent }: { channel: string; threadTs?: string; placeholder: string; onSent: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api("POST", "/api/slack/messages", { channel, text, threadTs: threadTs ?? null });
      setText("");
      onSent();
    } catch (e) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-3 pt-1">
      <div className="rounded-xl border bg-inset transition-colors focus-within:border-border-strong">
        <Textarea
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-[11px] text-muted-foreground">
            <kbd className="font-mono">Enter</kbd> enviar · <kbd className="font-mono">Shift+Enter</kbd> nueva línea
          </span>
          <Button size="icon-sm" className="rounded-full" onClick={send} disabled={busy || !text.trim()} aria-label="Enviar">
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

function useBottom(dep: unknown) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  return ref;
}

function Thread({ channel, where, ts, onClose }: { channel: string; where: string; ts: string; onClose: () => void }) {
  const key = `/api/slack/replies?channel=${channel}&ts=${ts}`;
  const { data, error } = useApi<{ messages: Message[] }>(key, { refreshInterval: 8000 });
  const ref = useBottom(data?.messages.length);
  return (
    <aside className="flex min-h-0 w-full flex-col border-l bg-sidebar/40 lg:w-96">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div>
          <div className="text-sm font-semibold">Hilo</div>
          <div className="text-[11px] text-muted-foreground">{where}</div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Cerrar hilo">
          <XIcon />
        </Button>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto py-2">
        {error && <p className="p-3 text-sm text-destructive">{error.message}</p>}
        {data && <MessageList messages={data.messages} where={where} />}
      </div>
      <Composer channel={channel} threadTs={ts} placeholder="Responder en el hilo…" onSent={() => refresh(key, `/api/slack/history?channel=${channel}`)} />
    </aside>
  );
}

function InboxItem({ c, active, onClick }: { c: Channel; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        !c.isMember && "opacity-60",
      )}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 -left-1.5 w-0.5 rounded-full bg-foreground" />}
      <span className="grid size-6 shrink-0 place-items-center">
        <ChannelGlyph c={c} className="size-3.5" />
      </span>
      <span className="truncate">{c.name}</span>
    </button>
  );
}

export default function MessagesPage() {
  const { data: status } = useApi<Record<string, { configured: boolean; secretHint?: string }>>("/api/integrations");
  const configured = status?.slack?.configured;
  const { data: chans, error: chanErr } = useApi<{ channels: Channel[] }>(configured ? "/api/slack/channels" : null);
  const [channel, setChannel] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const current = channel ?? chans?.channels.find((c) => c.isMember)?.id ?? null;
  const histKey = current ? `/api/slack/history?channel=${current}` : null;
  const { data: hist, error: histErr } = useApi<{ messages: Message[] }>(histKey, { refreshInterval: 8000 });
  const ref = useBottom(`${current}:${hist?.messages.length}`);
  const ch = chans?.channels.find((c) => c.id === current);
  const where = ch ? (ch.kind === "dm" ? `mensaje directo con ${ch.name}` : ch.kind === "group" ? ch.name : `#${ch.name}`) : "";

  if (status && !configured)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon={MessagesSquareIcon} title="Mensajes" description="Tus conversaciones de Slack, dentro de Agentic." />
        <EmptyState
          icon={MessagesSquareIcon}
          title="Conecta Slack"
          description="Conecta Slack en Integraciones para leer y responder tus canales y mensajes directos desde aquí."
          action={
            <Button asChild size="sm">
              <Link href="/integrations">Ir a Integraciones</Link>
            </Button>
          }
        />
      </div>
    );

  const q = filter.trim().toLowerCase();
  const shown = (chans?.channels ?? []).filter((c) => c.name.toLowerCase().includes(q));
  const channels = shown.filter((c) => (c.kind ?? "channel") === "channel");
  const direct = shown.filter((c) => c.kind === "dm" || c.kind === "group");
  const botOnly = !!chans && !(chans.channels ?? []).some((c) => c.kind === "dm" || c.kind === "group") && status?.slack?.secretHint?.startsWith("xoxb");
  const pick = (id: string) => {
    setChannel(id);
    setThread(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={MessagesSquareIcon} title="Mensajes" description="Lee, responde y convierte conversaciones en tareas." />
      {chanErr && <p className="text-sm text-destructive">{chanErr.message}</p>}
      <div className="flex h-[calc(100vh-13rem)] min-h-[480px] overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/30">
        <nav className="hidden w-68 shrink-0 flex-col border-r bg-sidebar/60 md:flex" aria-label="Conversaciones">
          <div className="flex h-14 items-center gap-2 border-b px-3">
            <div className="relative flex-1">
              <SearchIcon className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar conversación"
                aria-label="Buscar conversación"
                className="h-8 w-full rounded-md border bg-inset pr-2 pl-8 text-xs outline-none focus:border-border-strong"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {!chans && <Skeleton className="m-1 h-40" />}
            {channels.length > 0 && <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Canales</div>}
            {channels.map((c) => (
              <InboxItem key={c.id} c={c} active={c.id === current} onClick={() => pick(c.id)} />
            ))}
            {(direct.length > 0 || botOnly) && <div className="px-2 pt-4 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Mensajes directos</div>}
            {direct.map((c) => (
              <InboxItem key={c.id} c={c} active={c.id === current} onClick={() => pick(c.id)} />
            ))}
            {botOnly && (
              <p className="mx-2 rounded-md border border-dashed p-2 text-[11px] leading-relaxed text-muted-foreground">
                Para ver tus mensajes directos usa tu <b className="text-foreground">User OAuth Token</b> (<code>xoxp-…</code>) en vez del token del bot.{" "}
                <Link href="/integrations" className="text-link hover:underline">
                  Cambiarlo
                </Link>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <ProviderIcon provider="slack" className="size-3" /> Conectado a Slack
          </div>
        </nav>
        <section className={cn("flex min-w-0 flex-1 flex-col", thread && "hidden lg:flex")}>
          <div className="flex h-14 items-center gap-3 border-b px-4">
            <select
              aria-label="Conversación"
              className="rounded-md border bg-inset px-2 py-1 text-sm md:hidden"
              value={current ?? ""}
              onChange={(e) => pick(e.target.value)}
            >
              {chans?.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind === "dm" || c.kind === "group" ? c.name : `#${c.name}`}
                </option>
              ))}
            </select>
            <span className="hidden items-center gap-2 md:flex">
              <span className="grid size-8 place-items-center rounded-lg border bg-inset">
                <ChannelGlyph c={ch} className="size-4" />
              </span>
              <span>
                <span className="block text-sm leading-tight font-semibold">{ch?.name ?? "—"}</span>
                <span className="block max-w-md truncate text-[11px] text-muted-foreground">
                  {ch?.kind === "dm" ? "Mensaje directo" : ch?.kind === "group" ? "Grupo" : ch?.topic || (ch?.isPrivate ? "Canal privado" : "Canal")}
                </span>
              </span>
            </span>
          </div>
          <div ref={ref} className="flex-1 overflow-y-auto pb-2">
            {histErr && <p className="p-3 text-sm text-destructive">{histErr.message}</p>}
            {!hist && !histErr && current && <Skeleton className="m-3 h-40" />}
            {hist && <MessageList messages={hist.messages} where={where} onThread={(m) => setThread(m.threadTs ?? m.ts)} />}
            {hist && !hist.messages.length && (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
                <div>
                  <MessagesSquareIcon className="mx-auto mb-2 size-6 opacity-50" /> No hay mensajes recientes.
                </div>
              </div>
            )}
          </div>
          {current && <Composer channel={current} placeholder={`Escribe en ${where || "la conversación"}`} onSent={() => histKey && refresh(histKey)} />}
        </section>
        {thread && current && <Thread channel={current} where={where} ts={thread} onClose={() => setThread(null)} />}
      </div>
    </div>
  );
}
