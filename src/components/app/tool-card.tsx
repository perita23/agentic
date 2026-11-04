"use client";

import * as React from "react";
import {
  BotIcon, CheckIcon, ChevronDownIcon, CloudIcon, ContainerIcon, DatabaseIcon, FlaskConicalIcon, FolderIcon, GitBranchIcon, GlobeIcon,
  KeyRoundIcon, ListChecksIcon, LoaderCircleIcon, PackageIcon, PencilIcon, PlugIcon, SearchIcon, ShipIcon, TerminalIcon, FileTextIcon, XIcon,
} from "lucide-react";
import { describeTool, stripAnsi, type ToolIcon } from "@/lib/tool-cards";
import { cn } from "@/lib/utils";
import { linkify } from "./linkify";

const ICONS: Record<ToolIcon, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  docker: { icon: ContainerIcon, tone: "bg-sky-500/15 text-sky-400" },
  git: { icon: GitBranchIcon, tone: "bg-orange-500/15 text-orange-400" },
  package: { icon: PackageIcon, tone: "bg-amber-500/15 text-amber-400" },
  test: { icon: FlaskConicalIcon, tone: "bg-emerald-500/15 text-emerald-400" },
  kube: { icon: ShipIcon, tone: "bg-blue-500/15 text-blue-400" },
  web: { icon: GlobeIcon, tone: "bg-cyan-500/15 text-cyan-400" },
  db: { icon: DatabaseIcon, tone: "bg-violet-500/15 text-violet-400" },
  files: { icon: FolderIcon, tone: "bg-zinc-500/20 text-zinc-300" },
  cloud: { icon: CloudIcon, tone: "bg-indigo-500/15 text-indigo-400" },
  ssh: { icon: KeyRoundIcon, tone: "bg-rose-500/15 text-rose-400" },
  terminal: { icon: TerminalIcon, tone: "bg-zinc-500/20 text-zinc-300" },
  edit: { icon: PencilIcon, tone: "bg-green-500/15 text-green-400" },
  read: { icon: FileTextIcon, tone: "bg-blue-500/15 text-blue-400" },
  search: { icon: SearchIcon, tone: "bg-fuchsia-500/15 text-fuchsia-400" },
  agent: { icon: BotIcon, tone: "bg-purple-500/15 text-purple-400" },
  todo: { icon: ListChecksIcon, tone: "bg-teal-500/15 text-teal-400" },
  mcp: { icon: PlugIcon, tone: "bg-pink-500/15 text-pink-400" },
};

export interface ToolResult {
  content: unknown;
  isError: boolean;
}

/** Text and images inside a tool result (Claude can return screenshots and pictures). */
export function resultParts(content: unknown): { text: string; images: { src: string }[] } {
  if (typeof content === "string") return { text: content, images: [] };
  const text: string[] = [];
  const images: { src: string }[] = [];
  if (Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (typeof b === "string") text.push(b);
      else if (b?.type === "text" && typeof b.text === "string") text.push(b.text);
      else if (b?.type === "image") {
        const s = b.source as { type?: string; media_type?: string; data?: string } | undefined;
        if (s?.type === "base64" && s.data && /^image\/(png|jpeg|gif|webp)$/.test(s.media_type ?? "")) images.push({ src: `data:${s.media_type};base64,${s.data}` });
      }
    }
  }
  return { text: text.join("\n"), images };
}

export function ResultImages({ images }: { images: { src: string }[] }) {
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((im, i) => (
        <a key={i} href={im.src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.src} alt="Imagen de Claude" className="max-h-72 max-w-full object-contain" />
        </a>
      ))}
    </div>
  );
}

function Output({ text, error }: { text: string; error: boolean }) {
  const clean = stripAnsi(text).replace(/\s+$/, "");
  const lines = clean.split("\n");
  const [all, setAll] = React.useState(false);
  if (!clean) return <div className="px-3 py-2 text-xs text-muted-foreground">Sin salida.</div>;
  const shown = all || lines.length <= 24 ? clean : lines.slice(-24).join("\n");
  return (
    <div>
      {lines.length > 24 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full cursor-pointer border-b px-3 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground">
          {all ? "Mostrar sólo las últimas 24 líneas" : `… ${lines.length - 24} líneas más arriba · ver todo`}
        </button>
      )}
      <pre className={cn("max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap", error ? "text-destructive" : "text-muted-foreground")}>{linkify(shown.slice(0, 20000))}</pre>
    </div>
  );
}

function EditPreview({ name, input }: { name: string; input: Record<string, unknown> }) {
  const edits = name === "MultiEdit" && Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [input];
  const lines = (s: unknown) => (typeof s === "string" ? s.split("\n").slice(0, 40) : []);
  return (
    <div className="max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
      {name === "Write" ? (
        lines(input.content).map((l, i) => <div key={i} className="bg-success/10 px-3 whitespace-pre-wrap text-success">+ {l}</div>)
      ) : (
        edits.map((e, k) => (
          <div key={k} className={k ? "border-t" : ""}>
            {lines(e.old_string).map((l, i) => <div key={"o" + i} className="bg-destructive/10 px-3 whitespace-pre-wrap text-destructive">− {l}</div>)}
            {lines(e.new_string).map((l, i) => <div key={"n" + i} className="bg-success/10 px-3 whitespace-pre-wrap text-success">+ {l}</div>)}
          </div>
        ))
      )}
    </div>
  );
}

function Todos({ input }: { input: Record<string, unknown> }) {
  const todos = (Array.isArray(input.todos) ? input.todos : []) as { content?: string; status?: string }[];
  return (
    <ul className="grid gap-1 px-3 py-2 text-xs">
      {todos.map((t, i) => (
        <li key={i} className={cn("flex items-center gap-2", t.status === "completed" && "text-muted-foreground line-through")}>
          <span className={cn("grid size-3.5 place-items-center rounded-full border", t.status === "completed" ? "border-success bg-success/20 text-success" : t.status === "in_progress" ? "border-warning text-warning" : "")}>
            {t.status === "completed" ? <CheckIcon className="size-2.5" /> : t.status === "in_progress" ? <span className="size-1.5 rounded-full bg-warning" /> : null}
          </span>
          {t.content}
        </li>
      ))}
    </ul>
  );
}

/** A tool call as a card: what it does, the command, and its output, instead of a bare "Bash". */
export function ToolCard({ name, input, result, finished }: { name: string; input: unknown; result?: ToolResult; finished: boolean }) {
  const info = describeTool(name, input);
  const { icon: Icon, tone } = ICONS[info.icon];
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const parts = result ? resultParts(result.content) : null;
  const running = !result && !finished;
  const isShell = name === "Bash" || name === "BashOutput";
  const isEdit = name === "Edit" || name === "MultiEdit" || name === "Write";
  const [open, setOpen] = React.useState(false);
  const expanded = open || (result?.isError ?? false);
  const hasBody = isShell || isEdit || name === "TodoWrite" || !!parts?.text || !!parts?.images.length || !!info.detail;

  return (
    <div className={cn("ml-6 overflow-hidden rounded-lg border bg-inset text-xs", result?.isError && "border-destructive/40")}>
      <button type="button" disabled={!hasBody} onClick={() => setOpen((v) => !v)} aria-expanded={expanded} className="flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left hover:bg-accent/40 disabled:cursor-default">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", tone)}>
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">{info.group}</span>
          <span className="block truncate text-[13px] font-medium text-foreground">{info.title || name}</span>
        </span>
        {running ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-warning" aria-label="En curso" /> : result?.isError ? <XIcon className="size-3.5 shrink-0 text-destructive" aria-label="Error" /> : result ? <CheckIcon className="size-3.5 shrink-0 text-success" aria-label="Hecho" /> : null}
        {hasBody && <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />}
      </button>
      {parts && parts.images.length > 0 && <div className="border-t p-2"><ResultImages images={parts.images} /></div>}
      {expanded && (
        <div className="border-t">
          {isShell && <div className="overflow-x-auto bg-black/30 px-3 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all text-foreground"><span className="text-success select-none">$ </span>{info.detail}</div>}
          {isEdit && <EditPreview name={name} input={inp} />}
          {name === "TodoWrite" && <Todos input={inp} />}
          {!isShell && !isEdit && name !== "TodoWrite" && info.detail && <div className="px-3 py-1.5 font-mono text-[11px] break-all text-muted-foreground">{info.detail}</div>}
          {parts?.text ? (isEdit && !result?.isError ? null : <div className="border-t first:border-t-0"><Output text={parts.text} error={!!result?.isError} /></div>) : null}
        </div>
      )}
    </div>
  );
}
