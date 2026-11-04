"use client";

import * as React from "react";
import { SlashIcon, SparklesIcon, UserIcon, FolderIcon } from "lucide-react";
import { useApi } from "@/lib/api";
import { BUILTIN, type SlashCommand } from "@/lib/slash";
import { cn } from "@/lib/utils";

const KIND_LABEL = { builtin: "Agentic", user: "Tuyo", project: "Proyecto", skill: "Skill" } as const;
const KIND_ICON = { builtin: SlashIcon, user: UserIcon, project: FolderIcon, skill: SparklesIcon } as const;

/** Agentic's commands + Claude Code's custom commands and skills for a project. */
export function useSlashCommands(project?: string | null): SlashCommand[] {
  const { data } = useApi<{ commands: SlashCommand[] }>(`/api/commands${project ? `?project=${encodeURIComponent(project)}` : ""}`);
  return React.useMemo(() => [...BUILTIN, ...(data?.commands ?? [])], [data]);
}

/** State and keyboard handling of the "/" menu for a textarea (`/name` as the whole text so far). */
export function useSlashMenu(text: string, setText: (t: string) => void, commands: SlashCommand[]) {
  const [active, setActive] = React.useState(0);
  const m = /^\/([\w:.-]*)$/.exec(text);
  const items = m ? commands.filter((c) => c.name.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 8) : [];
  const open = items.length > 0;
  const idx = Math.min(active, Math.max(items.length - 1, 0));
  const pick = (c: SlashCommand) => {
    setText(`/${c.name} `);
    setActive(0);
  };
  /** Returns true when the key was used by the menu. */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % items.length : (a - 1 + items.length) % items.length));
      return true;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      pick(items[idx]);
      return true;
    }
    return false;
  };
  return { open, items, active: idx, pick, onKeyDown };
}

export function SlashList({ items, active, onPick, className }: { items: SlashCommand[]; active: number; onPick: (c: SlashCommand) => void; className?: string }) {
  if (!items.length) return null;
  return (
    <div role="listbox" aria-label="Comandos" className={cn("absolute bottom-full left-0 z-20 mb-1.5 w-full max-w-md overflow-hidden rounded-lg border bg-popover p-1 shadow-xl", className)}>
      {items.map((c, i) => {
        const Icon = KIND_ICON[c.kind];
        return (
          <button
            key={`${c.kind}:${c.name}`}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent/60")}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-mono font-medium">/{c.name}</span>
                {c.hint && <span className="truncate font-mono text-[11px] text-muted-foreground">{c.hint}</span>}
                <span className="ml-auto text-[10px] text-muted-foreground uppercase">{KIND_LABEL[c.kind]}</span>
              </span>
              {c.description && <span className="block truncate text-xs text-muted-foreground">{c.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
