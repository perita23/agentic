"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { linkify } from "./linkify";

/**
 * Claude's text as readable Markdown: headings, lists, tables, code. Raw HTML in the text is never rendered
 * (react-markdown ignores it) and links only keep safe protocols; they open outside the app.
 */
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
  pre: ({ children }) => <pre className="my-2 max-h-96 overflow-auto rounded-md border bg-inset p-3 font-mono text-xs leading-relaxed">{children}</pre>,
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
export function Markdown({ children, className }: { children: string; className?: string }) {
  const artifact = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;
  const links = [...new Set(children.match(artifact) ?? [])];
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
      {links.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{links.map((u) => <React.Fragment key={u}>{linkify(u, u)}</React.Fragment>)}</div>}
    </div>
  );
}
