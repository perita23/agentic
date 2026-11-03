"use client";

import * as React from "react";
import Link from "next/link";
import { HashIcon, LockIcon, MessageSquareReplyIcon, MessagesSquareIcon, PaperclipIcon, SearchIcon, SendHorizonalIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { ProviderIcon } from "@/components/app/provider-icon";
import { api, refresh, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Channel {
  id: string;
  name: string;
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

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold uppercase text-muted-foreground">{name.slice(0, 2)}</span>
  );
}

function MessageItem({ m, onThread }: { m: Message; onThread?: () => void }) {
  return (
    <div className="group flex gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40">
      <Avatar name={m.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{m.author}</span>
          <span className="text-[11px] text-muted-foreground">{time(m.ts)}</span>
        </div>
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{plain(m.text)}</div>
        {m.files.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
            {m.files.map((f) => (
              <span key={f} className="flex items-center gap-1 rounded border px-1.5 py-0.5">
                <PaperclipIcon className="size-3" /> {f}
              </span>
            ))}
          </div>
        )}
        {onThread && (
          <button onClick={onThread} className="mt-1 flex cursor-pointer items-center gap-1 text-xs text-link hover:underline">
            <MessageSquareReplyIcon className="size-3.5" />
            {m.replyCount > 0 ? `${m.replyCount} respuesta${m.replyCount > 1 ? "s" : ""}` : <span className="opacity-0 group-hover:opacity-100">Responder en hilo</span>}
          </button>
        )}
      </div>
    </div>
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
    <div className="flex items-end gap-2 border-t p-3">
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
        className="max-h-40 min-h-9"
      />
      <Button size="icon" onClick={send} disabled={busy || !text.trim()} aria-label="Enviar">
        <SendHorizonalIcon />
      </Button>
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

function Thread({ channel, ts, onClose }: { channel: string; ts: string; onClose: () => void }) {
  const key = `/api/slack/replies?channel=${channel}&ts=${ts}`;
  const { data, error } = useApi<{ messages: Message[] }>(key, { refreshInterval: 8000 });
  const ref = useBottom(data?.messages.length);
  return (
    <aside className="flex min-h-0 w-full flex-col border-l lg:w-96">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-semibold">Hilo</span>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Cerrar hilo">
          <XIcon />
        </Button>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto p-2">
        {error && <p className="p-2 text-sm text-destructive">{error.message}</p>}
        {data?.messages.map((m, i) => (
          <React.Fragment key={m.ts}>
            <MessageItem m={m} />
            {i === 0 && data.messages.length > 1 && <div className="my-1 border-b" />}
          </React.Fragment>
        ))}
      </div>
      <Composer channel={channel} threadTs={ts} placeholder="Responder en el hilo…" onSent={() => refresh(key, `/api/slack/history?channel=${channel}`)} />
    </aside>
  );
}

export default function MessagesPage() {
  const { data: status } = useApi<Record<string, { configured: boolean }>>("/api/integrations");
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

  if (status && !configured)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon={MessagesSquareIcon} title="Mensajes" description="Tus canales de Slack, sin salir de Agentic." />
        <EmptyState
          icon={MessagesSquareIcon}
          title="Conecta Slack"
          description="Añade un bot token en Integraciones para leer y responder mensajes desde aquí."
          action={
            <Button asChild size="sm">
              <Link href="/integrations">Ir a Integraciones</Link>
            </Button>
          }
        />
      </div>
    );

  const shown = (chans?.channels ?? []).filter((c) => c.name.includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={MessagesSquareIcon} title="Mensajes" description="Lee y responde en tus canales de Slack." />
      {chanErr && <p className="text-sm text-destructive">{chanErr.message}</p>}
      <div className="flex h-[calc(100vh-13rem)] min-h-[480px] overflow-hidden rounded-lg border bg-card">
        <nav className="hidden w-60 shrink-0 flex-col border-r md:flex" aria-label="Canales">
          <div className="flex items-center gap-2 border-b p-2">
            <ProviderIcon provider="slack" className="size-4 text-muted-foreground" />
            <div className="relative flex-1">
              <SearchIcon className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Canales" className="h-7 pl-7 text-xs" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {!chans && <Skeleton className="m-1 h-40" />}
            {shown.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setChannel(c.id);
                  setThread(null);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm",
                  c.id === current ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  !c.isMember && "opacity-60",
                )}
              >
                {c.isPrivate ? <LockIcon className="size-3.5" /> : <HashIcon className="size-3.5" />}
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </nav>
        <section className={cn("flex min-w-0 flex-1 flex-col", thread && "hidden lg:flex")}>
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <select
              aria-label="Canal"
              className="rounded-md border bg-inset px-2 py-1 text-sm md:hidden"
              value={current ?? ""}
              onChange={(e) => setChannel(e.target.value)}
            >
              {chans?.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <span className="hidden items-center gap-1 font-semibold md:flex">
              {ch?.isPrivate ? <LockIcon className="size-4" /> : <HashIcon className="size-4" />} {ch?.name ?? "—"}
            </span>
            {ch?.topic && <span className="truncate text-xs text-muted-foreground">{ch.topic}</span>}
          </div>
          <div ref={ref} className="flex-1 overflow-y-auto p-2">
            {histErr && <p className="p-3 text-sm text-destructive">{histErr.message}</p>}
            {!hist && !histErr && current && <Skeleton className="m-2 h-40" />}
            {hist?.messages.map((m) => (
              <MessageItem key={m.ts} m={m} onThread={() => setThread(m.threadTs ?? m.ts)} />
            ))}
            {hist && !hist.messages.length && <p className="p-6 text-center text-sm text-muted-foreground">No hay mensajes recientes en este canal.</p>}
          </div>
          {current && <Composer channel={current} placeholder={`Mensaje en #${ch?.name ?? ""}`} onSent={() => histKey && refresh(histKey)} />}
        </section>
        {thread && current && <Thread channel={current} ts={thread} onClose={() => setThread(null)} />}
      </div>
    </div>
  );
}
