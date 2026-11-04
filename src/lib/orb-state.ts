/** What Claude is doing right now, derived from a run's stream-json events (client and server). */
export type OrbState = "idle" | "thinking" | "writing" | "reading" | "editing" | "running" | "searching" | "waiting" | "done" | "error";
export interface Activity {
  state: OrbState;
  label: string;
}

export const ORB_LABEL: Record<OrbState, string> = {
  idle: "En reposo",
  thinking: "Pensando…",
  writing: "Escribiendo la respuesta…",
  reading: "Leyendo ficheros…",
  editing: "Editando ficheros…",
  running: "Ejecutando un comando…",
  searching: "Buscando…",
  waiting: "Esperando tu respuesta",
  done: "Terminado",
  error: "Ha fallado",
};

const READ = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const EDIT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SEARCH = new Set(["WebSearch", "WebFetch"]);

export function toolState(name: string): OrbState {
  if (READ.has(name)) return "reading";
  if (EDIT.has(name)) return "editing";
  if (name === "Bash" || name === "BashOutput" || name.startsWith("mcp__")) return "running";
  if (SEARCH.has(name)) return "searching";
  if (name === "AskUserQuestion") return "waiting";
  if (name === "Artifact") return "writing";
  return "thinking";
}

type Ev = { type?: string; subtype?: string; is_error?: boolean; code?: unknown; message?: { content?: unknown } } & Record<string, unknown>;

/** The state after the last meaningful event. No events yet = just started = thinking. */
export function stateFromEvents(events: unknown[]): Activity {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as Ev | null;
    if (!e || typeof e !== "object") continue;
    let state: OrbState | null = null;
    if (e.type === "result") {
      // Finished, but Claude asked something (or a tool needed permission): it is waiting for the user.
      const asks = typeof e.result === "string" && /\?\s*$/.test(e.result.trim());
      const denied = Array.isArray(e.permission_denials) && e.permission_denials.length > 0;
      state = e.is_error ? "error" : asks || denied ? "waiting" : "done";
    }
    else if (e.type === "agentic" && e.subtype === "exit") state = e.code === 0 ? "done" : "error";
    else if (e.type === "assistant") {
      const blocks = Array.isArray(e.message?.content) ? (e.message!.content as { type?: string; name?: string }[]) : [];
      const last = blocks[blocks.length - 1];
      if (last?.type === "tool_use") state = toolState(String(last.name ?? ""));
      else if (last?.type === "thinking") state = "thinking";
      else if (last?.type === "text") state = "writing";
    } else if (e.type === "user" || (e.type === "system" && e.subtype === "init")) state = "thinking";
    if (state) return { state, label: ORB_LABEL[state] };
  }
  return { state: "thinking", label: ORB_LABEL.thinking };
}
