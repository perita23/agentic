"use client";

import * as React from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";

interface Section {
  version: string;
  date: string | null;
  body: string;
}

/** **bold**, `code` and [text](url) → React nodes (never raw HTML). */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-foreground">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-secondary px-1 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    else out.push(t.slice(1, t.indexOf("]")));
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Just what our CHANGELOG uses: "### Heading", "- item" (two-space nesting) and paragraphs. */
function Notes({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { depth: number; text: string }[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="grid gap-1.5">
        {list.map((li, i) => (
          <li key={i} className="flex gap-2" style={{ marginLeft: li.depth * 16 }}>
            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
            <span>{inline(li.text)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const item = /^(\s*)- (.*)$/.exec(line);
    if (item) {
      list.push({ depth: Math.floor(item[1].length / 2), text: item[2] });
      continue;
    }
    flush();
    if (/^###\s+/.test(line)) blocks.push(<h4 key={blocks.length} className="mt-2 text-xs font-semibold tracking-wide text-foreground uppercase">{line.replace(/^###\s+/, "")}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="grid gap-2 text-sm leading-relaxed text-muted-foreground">{blocks}</div>;
}

/** Shown once after the app is updated, with the notes of every version since the last one you saw. */
export function WhatsNew() {
  const { data } = useApi<{ current: string; show: boolean; sections: Section[] }>("/api/whats-new");
  const [open, setOpen] = React.useState(true);
  if (!data?.show || !open) return null;

  function close() {
    setOpen(false);
    void api("POST", "/api/whats-new").catch(() => {});
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-purple" /> Novedades de la v{data.current}
          </DialogTitle>
          <DialogDescription>Agentic se ha actualizado. Esto es lo que cambia.</DialogDescription>
        </DialogHeader>
        <div className="scroll-area -mx-1 grid gap-5 px-1">
          {data.sections.map((s) => (
            <section key={s.version} className="grid gap-2">
              {data.sections.length > 1 && (
                <div className="flex items-baseline gap-2 border-b pb-1">
                  <span className="font-mono text-sm font-semibold">v{s.version}</span>
                  {s.date && <span className="text-xs text-muted-foreground">{s.date}</span>}
                </div>
              )}
              <Notes body={s.body} />
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={close}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
