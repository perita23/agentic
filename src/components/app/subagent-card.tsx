"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { describeTool, stripAnsi } from "@/lib/tool-cards";
import { toolState, type OrbState } from "@/lib/orb-state";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MorphText } from "./live-status";
import { LiquidOrb } from "./liquid-orb";
import { Markdown } from "./markdown";
import { resultParts, type ToolResult } from "./tool-card";

/** A call that launches a subagent (named "Agent" in current Claude Code, "Task" in older ones). */
export const isSubagentTool = (name: unknown) => name === "Agent" || name === "Task";

export interface SubStep {
  id: string;
  name: string;
  input: unknown;
  result?: ToolResult;
}

const MODEL_LABEL: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", inherit: "El del planificador" };
/** Power in dots, like the Orchestrator's cubes: nothing is priced in money. */
const POWER: Record<string, number> = { opus: 3, sonnet: 2, haiku: 1 };

interface Preview {
  agents?: Record<string, { description: string; model?: string; tools?: string[] }>;
}

/** What the orchestrator knows about a subagent by its name (its model, whether it only reads). */
function useAgentInfo(name: string) {
  const { data } = useApi<{ chats?: Preview | null; runs?: Preview | null }>("/api/orchestrator/preview", { revalidateOnFocus: false });
  return data?.chats?.agents?.[name] ?? data?.runs?.agents?.[name] ?? null;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

function ModelBadge({ model }: { model: string }) {
  const n = POWER[model] ?? 0;
  return (
    <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground" title={n === 1 ? "Más rápido y barato" : n === 2 ? "Equilibrado" : n === 3 ? "El más capaz" : undefined}>
      {MODEL_LABEL[model] ?? model}
      {n > 0 && (
        <span className="flex gap-0.5" aria-hidden>
          {[1, 2, 3].map((i) => (
            <i key={i} className={cn("size-1 rounded-full", i <= n ? "bg-foreground/70" : "bg-foreground/15")} />
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * One subagent Claude launched: who it is (name, model), what it was asked, what it is doing right now, the steps it
 * took, and what it handed back. While it works its border flows with the orb's colours and a small orb shows its state.
 */
export function SubagentCard({ input, result, finished, steps }: { id: string; input: unknown; result?: ToolResult; finished: boolean; steps: SubStep[] }) {
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = text(inp.subagent_type) || "subagente";
  const info = useAgentInfo(name);
  const model = text(inp.model) || info?.model || "";
  const running = !result && !finished;
  const failed = !!result?.isError;
  const last = steps[steps.length - 1];
  const doing = last ? describeTool(last.name, last.input) : null;
  const state: OrbState = failed ? "error" : !running ? "done" : last && !last.result ? toolState(last.name) : "thinking";
  const parts = result ? resultParts(result.content) : null;
  const [open, setOpen] = React.useState(false);
  const readOnly = info?.tools && info.tools.length > 0 && !info.tools.some((t) => ["Edit", "Write", "NotebookEdit"].includes(t));

  const body = (
    <div className={cn("overflow-hidden rounded-[calc(var(--radius-lg,0.5rem)-1px)] bg-card text-xs", !running && "rounded-lg border", failed && "border-destructive/40")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/30">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center">
          <LiquidOrb state={state} size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-[13px] font-semibold">{name}</b>
            {model && <ModelBadge model={model} />}
            {readOnly && <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">solo lee</span>}
          </span>
          <span className="mt-0.5 block truncate text-muted-foreground">{text(inp.description) || text(inp.prompt).slice(0, 90)}</span>
          <span className="mt-1.5 block">
            {running ? (
              <MorphText text={doing ? `${doing.group}${doing.title ? ` · ${doing.title}` : ""}` : "Empezando…"} state={state} glow className="text-[11px] font-medium" />
            ) : (
              <span className={cn("flex items-center gap-1.5 text-[11px]", failed ? "text-destructive" : "text-success")}>
                {failed ? <XIcon className="size-3" /> : <CheckIcon className="size-3" />}
                {failed ? "Falló" : "Hecho"}
                {steps.length > 0 && <span className="text-muted-foreground">· {steps.length} {steps.length === 1 ? "paso" : "pasos"}</span>}
              </span>
            )}
          </span>
        </span>
        <ChevronDownIcon className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {steps.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t px-3 py-1.5" aria-label="Pasos del subagente">
          {steps.slice(-8).map((s) => {
            const d = describeTool(s.name, s.input);
            return (
              <span key={s.id} title={d.detail || d.title} className={cn("max-w-44 truncate rounded-md border bg-inset px-1.5 py-0.5 text-[10px]", s.result?.isError ? "border-destructive/40 text-destructive" : s.result ? "text-muted-foreground" : "text-foreground")}>
                {d.group}
                {d.title ? ` · ${d.title}` : ""}
              </span>
            );
          })}
          {steps.length > 8 && <span className="px-1 py-0.5 text-[10px] text-muted-foreground">+{steps.length - 8} antes</span>}
        </div>
      )}
      {open && (
        <div className="grid gap-2 border-t px-3 py-2.5">
          {text(inp.prompt) && (
            <div>
              <div className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">Lo que se le pidió</div>
              <p className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">{text(inp.prompt)}</p>
            </div>
          )}
          {parts?.text && (
            <div>
              <div className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">Lo que devolvió</div>
              <div className="max-h-72 overflow-auto">{failed ? <pre className="font-mono text-[11px] whitespace-pre-wrap text-destructive">{stripAnsi(parts.text)}</pre> : <Markdown>{parts.text}</Markdown>}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
  return running ? <div className="orb-border" data-testid="subagent-card" data-state="running">{body}</div> : <div data-testid="subagent-card" data-state={failed ? "failed" : "done"}>{body}</div>;
}

/** Several subagents launched together, as a team. */
export function SubagentGroup({ children, count, parallel }: { children: React.ReactNode; count: number; parallel: boolean }) {
  return (
    <div data-testid="subagent-group" className="ml-6 grid gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="h-px w-4 bg-border-strong" />
        <span className="font-medium tracking-wide uppercase">{count === 1 ? "Subagente" : `${count} subagentes`}</span>
        {count > 1 && parallel && <span className="rounded-full border px-2 py-0.5">en paralelo</span>}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className={cn("grid gap-2", count > 1 && "md:grid-cols-2")}>{children}</div>
    </div>
  );
}

/** In the chat: what each subagent was asked, as small cards (a conversation keeps no results, only the calls). */
export function SubagentChips({ tools }: { tools: { name: string; input: string }[] }) {
  const calls = tools.filter((t) => isSubagentTool(t.name)).map((t) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(t.input);
    } catch {
      const m = /"subagent_type":\s*"([^"]*)"/.exec(t.input);
      const d = /"description":\s*"([^"]*)"/.exec(t.input);
      input = { subagent_type: m?.[1], description: d?.[1] };
    }
    return input;
  });
  if (!calls.length) return null;
  return (
    <div data-testid="subagent-chips" className="mb-2 grid gap-1.5 sm:grid-cols-2">
      {calls.map((c, i) => (
        <div key={i} className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-inset px-2.5 py-1.5 text-xs">
          <LiquidOrb state="done" size={18} />
          <span className="min-w-0">
            <b className="block truncate text-[12px] font-semibold">{text(c.subagent_type) || "subagente"}</b>
            <span className="block truncate text-muted-foreground">{text(c.description) || text(c.prompt).slice(0, 60)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
