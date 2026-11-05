"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkify } from "./linkify";

/**
 * Claude's text as readable Markdown: headings, lists, tables, code. Raw HTML in the text is never rendered
 * (react-markdown ignores it) and links only keep safe protocols; they open outside the app.
 */
const MAIL_LANGS: Record<string, string> = { email: "Correo", mail: "Correo", correo: "Correo", mensaje: "Mensaje", message: "Mensaje", texto: "Texto", text: "Texto" };

function nodeText(n: React.ReactNode): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join("");
  if (React.isValidElement(n)) return nodeText((n.props as { children?: React.ReactNode }).children);
  return "";
}

/** A fenced block with a Copy button. Emails and messages get their own colour and label so they stand out. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  const code = React.Children.toArray(children)[0];
  const lang = React.isValidElement(code) ? /language-([\w-]+)/.exec(String((code.props as { className?: string }).className ?? ""))?.[1]?.toLowerCase() : undefined;
  const label = lang ? MAIL_LANGS[lang] : undefined;
  const text = nodeText(children).replace(/\n$/, "");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }
  return (
    <div className={cn("my-2 overflow-hidden rounded-lg border", label ? "border-purple/40 bg-purple/[0.07]" : "bg-inset")}>
      <div className={cn("flex items-center justify-between gap-2 border-b px-3 py-1 text-[11px]", label ? "border-purple/30 text-purple" : "text-muted-foreground")}>
        <span className="font-medium">{label ?? lang ?? "código"}</span>
        <button type="button" onClick={copy} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-foreground/10 hover:text-foreground">
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />} {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className={cn("max-h-96 overflow-auto p-3 text-xs leading-relaxed", label ? "font-sans text-sm whitespace-pre-wrap" : "font-mono")}>{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-link underline-offset-2 hover:underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 mb-1.5 text-[15px] font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-4" />,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) =>
    className ? <code className={cn("font-mono", className)}>{children}</code> : <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
  input: ({ checked }) => <input type="checkbox" checked={checked} readOnly className="mr-1.5 align-middle accent-primary" />,
};

/** Claude artifact links keep their recognisable button: pull them out of the markdown flow. */
const BOOT = Date.now();
const typedSeen = new Set<string>();

/** Reveals `text` at a steady pace (about 8 s for a long answer) so new answers look typed instead of popping in. */
function useTyped(text: string, on: boolean): string {
  const [n, setN] = React.useState(() => (on && Date.now() - BOOT > 2500 && !typedSeen.has(text) ? 0 : text.length));
  React.useEffect(() => {
    if (n >= text.length) return;
    const t = setTimeout(() => setN((v) => Math.min(text.length, v + Math.max(2, Math.ceil(text.length / 500)))), 16);
    return () => clearTimeout(t);
  }, [n, text]);
  return n >= text.length ? text : text.slice(0, n);
}

export function Markdown({ children, className, reveal, onTyped }: { children: string; className?: string; reveal?: boolean; onTyped?: () => void }) {
  const shown = useTyped(children, !!reveal);
  const typing = shown.length < children.length;
  React.useEffect(() => {
    if (typing) return;
    typedSeen.add(children);
    onTyped?.();
  }, [typing, children, onTyped]);
  const artifact = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;
  const links = [...new Set(children.match(artifact) ?? [])];
  return (
    <div className={cn("text-sm leading-relaxed break-words", typing && "typing-caret", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {shown}
      </ReactMarkdown>
      {links.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{links.map((u) => <React.Fragment key={u}>{linkify(u, u)}</React.Fragment>)}</div>}
    </div>
  );
}
