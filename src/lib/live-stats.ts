/** What a running turn has done so far, read from its stream-json events (client and server). */
export interface LiveStats {
  /** Tokens Claude has written in this turn (sum over its messages, each counted once). */
  outputTokens: number;
  /** Size of the context sent with the latest message (input + cache). */
  contextTokens: number;
  /** The tool call in flight (no result yet) or null. */
  tool: { name: string; input: unknown } | null;
  /** The tail of Claude's reasoning, when the model streams it. */
  thinking: string;
  /** The answer being written right now, streamed piece by piece (empty between messages). */
  partial: string;
}

type Block = { type?: string; id?: string; name?: string; input?: unknown; text?: string; thinking?: string; tool_use_id?: string };
type Ev = { type?: string; subtype?: string; delta?: string; message?: { id?: string; usage?: Record<string, unknown>; content?: unknown } } | null;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Feed events in order; read `stats()` any time. */
export class LiveStatsAcc {
  private out = new Map<string, number>();
  private ctx = 0;
  private open = new Map<string, { name: string; input: unknown }>();
  private lastTool: string | null = null;
  private thinking = "";
  private partial = "";

  add(ev: unknown) {
    const e = ev as Ev;
    if (!e || typeof e !== "object") return;
    const m = e.message;
    if (e.type === "agentic" && e.subtype === "partial" && typeof e.delta === "string") this.partial = (this.partial + e.delta).slice(-20_000);
    else if (e.type === "assistant" || e.type === "user" || e.type === "result") this.partial = "";
    if (e.type === "assistant" && m) {
      const u = m.usage;
      if (u) {
        // The same message can arrive in several events with growing usage: keep the largest.
        const id = m.id ?? `anon${this.out.size}`;
        this.out.set(id, Math.max(this.out.get(id) ?? 0, num(u.output_tokens)));
        this.ctx = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
      }
      for (const b of Array.isArray(m.content) ? (m.content as Block[]) : []) {
        if (b?.type === "tool_use" && b.id && b.name) {
          this.open.set(b.id, { name: b.name, input: b.input });
          this.lastTool = b.id;
          this.thinking = "";
        } else if (b?.type === "thinking" && typeof b.thinking === "string") this.thinking = b.thinking.slice(-400);
        else if (b?.type === "text") this.thinking = "";
      }
    } else if (e.type === "user" && m) {
      for (const b of Array.isArray(m.content) ? (m.content as Block[]) : []) if (b?.type === "tool_result" && b.tool_use_id) this.open.delete(b.tool_use_id);
    }
  }

  stats(): LiveStats {
    let outputTokens = 0;
    for (const v of this.out.values()) outputTokens += v;
    // The newest call still waiting for its result.
    const tool = this.lastTool && this.open.has(this.lastTool) ? this.open.get(this.lastTool)! : [...this.open.values()].pop() ?? null;
    return { outputTokens, contextTokens: this.ctx, tool, thinking: this.thinking, partial: this.partial };
  }
}

export function liveStats(events: unknown[]): LiveStats {
  const a = new LiveStatsAcc();
  for (const e of events) a.add(e);
  return a.stats();
}

/** 1234 → "1,2k"; 48200 → "48k". */
export function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(".", ",") : Math.round(k)}k`;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
