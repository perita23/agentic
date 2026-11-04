/** Claude plan usage limits, as Claude Code reports them in `rate_limit_event` stream-json events. */
export interface RateLimit {
  type: string;
  status: string;
  /** Epoch ms when the window resets, if known. */
  resetsAt: number | null;
  /** 0..1 share of the limit used, if reported. */
  utilization: number | null;
  /** ISO time of the run it was observed in. */
  observedAt: string;
}

export const LIMIT_LABEL: Record<string, string> = {
  five_hour: "Ventana de 5 horas",
  seven_day: "Semana",
  seven_day_opus: "Semana · Opus",
  seven_day_sonnet: "Semana · Sonnet",
  overage: "Uso extra",
};

export const limitLabel = (type: string) => LIMIT_LABEL[type] ?? type.replace(/_/g, " ");

export const STATUS_LABEL: Record<string, { text: string; level: "ok" | "warn" | "over" }> = {
  allowed: { text: "Dentro del límite", level: "ok" },
  allowed_warning: { text: "Cerca del límite", level: "warn" },
  rejected: { text: "Límite alcanzado", level: "over" },
};

/** One `rate_limit_event` → a RateLimit (tolerant about missing fields and s/ms timestamps). */
export function parseRateLimit(event: unknown, observedAt: string): RateLimit | null {
  const e = event as { type?: string; rate_limit_info?: Record<string, unknown> } | null;
  if (!e || e.type !== "rate_limit_event" || !e.rate_limit_info || typeof e.rate_limit_info !== "object") return null;
  const i = e.rate_limit_info;
  const reset = typeof i.resetsAt === "number" && i.resetsAt > 0 ? (i.resetsAt > 1e12 ? i.resetsAt : i.resetsAt * 1000) : null;
  const u = typeof i.utilization === "number" && i.utilization >= 0 ? (i.utilization > 1 ? i.utilization / 100 : i.utilization) : null;
  return {
    type: typeof i.rateLimitType === "string" && i.rateLimitType ? i.rateLimitType : "unknown",
    status: typeof i.status === "string" ? i.status : "allowed",
    resetsAt: reset,
    utilization: u === null ? null : Math.min(1, u),
    observedAt,
  };
}

/** "2 h 14 min", "35 min", "ahora". */
export function untilReset(resetsAt: number, now = Date.now()): string {
  const min = Math.round((resetsAt - now) / 60_000);
  if (min <= 0) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.round(h / 24)} días`;
}
