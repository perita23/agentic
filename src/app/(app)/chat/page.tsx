"use client";

import * as React from "react";
import { ArrowUpIcon, Loader2Icon, MessageSquarePlusIcon, PinIcon, SearchIcon, SparklesIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark } from "@/components/app/brand-mark";
import { linkify } from "@/components/app/linkify";
import { ActivityOrb } from "@/components/app/liquid-orb";
import type { Activity } from "@/lib/orb-state";
import { errorMessage, PageHeader } from "@/components/app/common";
import { api, refresh, useApi } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

interface ChatItem {
  id: string;
  title: string;
  model: string | null;
  updatedAt: string;
  pinned?: boolean;
  running: boolean;
  activity?: Activity | null;
}
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  tools?: { name: string; input: string }[];
  timestamp?: string;
}
interface ChatDetail extends ChatItem {
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
const SUGGESTIONS = ["Explícame la diferencia entre rebase y merge", "Escribe un script que renombre fotos por fecha", "Revisa esta expresión regular y explícamela", "Ayúdame a planificar una migración a TypeScript"];

/** **bold** and `code` inside a line, as React nodes (never HTML). */
function inline(t: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of t.matchAll(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
    if (m.index! > last) out.push(...linkify(t.slice(last, m.index), `${key}-t${k++}`));
    out.push(
      m[0].startsWith("**") ? (
        <strong key={`${key}-${k++}`} className="font-semibold">
          {m[0].slice(2, -2)}
        </strong>
      ) : (
        <code key={`${key}-${k++}`} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em]">
          {m[0].slice(1, -1)}
        </code>
      ),
    );
    last = m.index! + m[0].length;
  }
  if (last < t.length) out.push(...linkify(t.slice(last), `${key}-t${k++}`));
  return out;
}

/** Claude's Markdown, rendered safely: code fences, headings, lists and paragraphs. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf("\n");
          const lang = nl > 0 ? part.slice(0, nl).trim() : "";
          const code = nl >= 0 ? part.slice(nl + 1) : part;
          return (
            <div key={i} className="overflow-hidden rounded-lg border bg-inset">
              {lang && <div className="border-b px-3 py-1 font-mono text-[11px] text-muted-foreground">{lang}</div>}
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{code.replace(/\n$/, "")}</pre>
            </div>
          );
        }
        return part
          .split(/\n{2,}/)
          .filter((b) => b.trim())
          .map((block, j) => {
            const lines = block.split("\n");
            const key = `${i}-${j}`;
            if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l)))
              return (
                <ul key={key} className="grid gap-1 pl-1">
                  {lines.map((l, n) => (
                    <li key={n} className="flex gap-2">
                      <span className="text-muted-foreground">{/^\s*\d+\./.test(l) ? l.trim().split(/\s/)[0] : "•"}</span>
                      <span>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), `${key}-${n}`)}</span>
                    </li>
                  ))}
                </ul>
              );
            if (/^#{1,4}\s/.test(lines[0]))
              return (
                <div key={key} className="grid gap-1">
                  <h3 className="font-semibold">{lines[0].replace(/^#+\s/, "")}</h3>
                  {lines.length > 1 && <p className="whitespace-pre-wrap">{inline(lines.slice(1).join("\n"), key)}</p>}
                </div>
              );
            return (
              <p key={key} className="whitespace-pre-wrap">
                {inline(block, key)}
              </p>
            );
          });
      })}
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap">{m.text}</div>
      </div>
    );
  return (
    <div className="flex gap-3">
      <BrandMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        {m.tools && m.tools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {m.tools.map((t, i) => (
              <span key={i} className="flex items-center gap-1 rounded-md border bg-inset px-2 py-0.5 font-mono text-[11px] text-muted-foreground" title={t.input}>
                <WrenchIcon className="size-3" /> {t.name}
              </span>
            ))}
          </div>
        )}
        {m.text.trim() && <RichText text={m.text} />}
      </div>
    </div>
  );
}

function Composer({ onSend, busy, autoFocus, model, setModel }: { onSend: (t: string) => Promise<boolean>; busy: boolean; autoFocus?: boolean; model: string; setModel: (m: string) => void }) {
  const [text, setText] = React.useState("");
  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    if (await onSend(t)) setText("");
  }
  return (
    <div className="rounded-2xl border bg-inset shadow-lg shadow-black/20 transition-colors focus-within:border-border-strong">
      <Textarea
        autoFocus={autoFocus}
        rows={2}
        value={text}
        placeholder="Escribe a Claude…"
        aria-label="Mensaje para Claude"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        className="max-h-60 min-h-14 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <select aria-label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} className="h-7 rounded-md border bg-card px-2 text-xs text-muted-foreground">
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <Button size="icon-sm" className="rounded-full" onClick={send} disabled={busy || !text.trim()} aria-label="Enviar">
          {busy ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
        </Button>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { data: list } = useApi<{ chats: ChatItem[] }>("/api/chats", { refreshInterval: 5000 });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [model, setModel] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const { data: chat } = useApi<ChatDetail>(selected ? `/api/chats/${selected}` : null, { refreshInterval: (d) => (d?.running ? 1500 : 0) });
  const bottom = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat?.messages.length, chat?.pendingPrompt, chat?.running, selected]);

  async function newChat(prompt: string) {
    setSending(true);
    try {
      const c = await api<ChatItem>("POST", "/api/chats", { prompt, model });
      setSelected(c.id);
      refresh("/api/chats");
      return true;
    } catch (e) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
      return false;
    } finally {
      setSending(false);
    }
  }

  async function reply(prompt: string) {
    if (!selected) return newChat(prompt);
    setSending(true);
    try {
      await api("POST", `/api/chats/${selected}/messages`, { prompt, model });
      refresh(`/api/chats/${selected}`, "/api/chats");
      return true;
    } catch (e) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
      return false;
    } finally {
      setSending(false);
    }
  }

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
      <PageHeader icon={SparklesIcon} title="Chat" description="Habla con Claude sin elegir proyecto. Tus conversaciones se guardan en tu dispositivo." />
      <div className="flex h-[calc(100vh-13rem)] min-h-[480px] overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/30">
        <nav className="hidden w-68 shrink-0 flex-col border-r bg-sidebar/60 md:flex" aria-label="Historial de chats">
          <div className="flex h-14 items-center gap-2 border-b px-3">
            <div className="relative flex-1">
              <SearchIcon className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar chats"
                aria-label="Buscar chats"
                className="h-8 w-full rounded-md border bg-inset pr-2 pl-8 text-xs outline-none focus:border-border-strong"
              />
            </div>
            <Button size="icon-sm" variant="outline" aria-label="Nuevo chat" onClick={() => setSelected(null)}>
              <MessageSquarePlusIcon />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
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
                {c.id === selected && <span className="absolute top-1.5 bottom-1.5 -left-1.5 w-0.5 rounded-full bg-foreground" />}
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

        <section className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
              <BrandMark className="size-14" />
              <h2 className="text-xl font-semibold tracking-tight">¿En qué te ayudo?</h2>
              <div className="w-full max-w-2xl">
                <Composer onSend={newChat} busy={sending} autoFocus model={model} setModel={setModel} />
              </div>
              <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => newChat(s)} disabled={sending} className="cursor-pointer rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex h-14 items-center gap-2 border-b px-4">
                <span className="truncate text-sm font-semibold">{chat?.title ?? "…"}</span>
                {chat?.model && <span className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{chat.model}</span>}
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto grid max-w-3xl gap-6 px-4 py-6">
                  {!chat && <Skeleton className="h-40" />}
                  {chat?.messages.map((m, i) => (
                    <Bubble key={i} m={m} />
                  ))}
                  {chat?.pendingPrompt && <Bubble m={{ role: "user", text: chat.pendingPrompt }} />}
                  {chat?.running && (
                    <ActivityOrb activity={chat.activity ?? { state: "thinking", label: "Pensando…" }} size={44} />
                  )}
                  {chat?.error && !chat.running && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{chat.error}</p>}
                  <div ref={bottom} />
                </div>
              </div>
              <div className="mx-auto w-full max-w-3xl px-4 pb-4">
                <Composer onSend={reply} busy={sending || !!chat?.running} model={model} setModel={setModel} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
