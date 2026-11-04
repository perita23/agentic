"use client";

import * as React from "react";
import { FileIcon, FolderIcon } from "lucide-react";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface FileHit {
  path: string;
  dir: boolean;
}

/** The "@query" being typed right before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/**
 * "@" autocomplete for a textarea: type @ and a few letters to pick a file or folder of the project.
 * Call `track` from the textarea's onChange/onSelect/onClick/onKeyUp so the caret position is known.
 */
export function useFileMenu(text: string, setText: (t: string) => void, ref: React.RefObject<HTMLTextAreaElement | null>, project: string | null | undefined, enabled = true) {
  const [caret, setCaret] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const at = enabled ? mentionAt(text, caret) : null;
  const key = at ? `${at.start}:${at.query}` : null;
  const { data } = useApi<{ files: FileHit[] }>(at && project && key !== dismissed ? `/api/files?project=${encodeURIComponent(project)}&q=${encodeURIComponent(at.query)}` : null, { keepPreviousData: true, revalidateOnFocus: false });
  const items = at && key !== dismissed ? (data?.files ?? []).slice(0, 8) : [];
  const open = items.length > 0;
  const idx = Math.min(active, Math.max(items.length - 1, 0));

  const pick = (f: FileHit) => {
    if (!at) return;
    const insert = `@${f.path}${f.dir ? "" : " "}`;
    const next = text.slice(0, at.start) + insert + text.slice(caret);
    setText(next);
    setActive(0);
    const pos = at.start + insert.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % items.length : (a - 1 + items.length) % items.length));
      return true;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      pick(items[idx]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(key);
      return true;
    }
    return false;
  };

  return { open, items, active: idx, pick, onKeyDown, track: (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? 0) };
}

export function FileList({ items, active, onPick }: { items: FileHit[]; active: number; onPick: (f: FileHit) => void }) {
  if (!items.length) return null;
  return (
    <div role="listbox" aria-label="Archivos" className="absolute bottom-full left-0 z-20 mb-1.5 w-full max-w-lg overflow-hidden rounded-lg border bg-popover p-1 shadow-xl">
      {items.map((f, i) => {
        const trimmed = f.dir ? f.path.slice(0, -1) : f.path;
        const slash = trimmed.lastIndexOf("/");
        const name = trimmed.slice(slash + 1) + (f.dir ? "/" : "");
        const dir = slash >= 0 ? trimmed.slice(0, slash + 1) : "";
        const Icon = f.dir ? FolderIcon : FileIcon;
        return (
          <button
            key={f.path}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(f);
            }}
            className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent/60")}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono font-medium">{name}</span>
            {dir && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{dir}</span>}
          </button>
        );
      })}
    </div>
  );
}
