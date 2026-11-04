import { z } from "zod";
import type { RunManager } from "./runs";
import type { SessionIndex } from "./sessions";
import type { JsonStore } from "./store";
import { HttpError, parse } from "./util";

/**
 * Spending guard-rails. Two meters, each with an optional daily and monthly limit:
 *  - runsUsd: exact USD reported by Claude Code for runs launched from Agentic
 *  - tokens:  input + output tokens of ALL Claude Code usage on this device
 *             (from local transcripts; useful on subscription plans)
 * Alerts fire once per period and level (warn / over). Days are UTC, like Analítica.
 */
const B = "budgets";
const ALERTS = "budget-alerts";

const limit = z.number().positive().max(1e12).nullable().default(null);
export const budgetConfigSchema = z.object({
  runsUsd: z.object({ daily: limit, monthly: limit }).default({ daily: null, monthly: null }),
  tokens: z.object({ daily: limit, monthly: limit }).default({ daily: null, monthly: null }),
  warnAt: z.number().min(0.5).max(0.99).default(0.8),
  /** Refuse to start queued and scheduled runs while a USD limit is exceeded. */
  blockAutomation: z.boolean().default(true),
});
export type BudgetConfig = z.infer<typeof budgetConfigSchema>;

export type Meter = "runsUsd" | "tokens";
export type Period = "daily" | "monthly";
export type Level = "ok" | "warn" | "over";
export interface BudgetLine {
  meter: Meter;
  period: Period;
  used: number;
  limit: number;
  ratio: number;
  level: Level;
}
export interface BudgetStatus {
  config: BudgetConfig;
  usage: Record<Meter, Record<Period, number>>;
  lines: BudgetLine[];
  level: Level;
  /** True when automatic runs are currently refused. */
  blocked: boolean;
}

const LABEL: Record<Meter, Record<Period, string>> = {
  runsUsd: { daily: "Gasto de hoy en ejecuciones", monthly: "Gasto del mes en ejecuciones" },
  tokens: { daily: "Tokens de hoy", monthly: "Tokens del mes" },
};

export function formatLine(l: BudgetLine) {
  const fmt = (n: number) => (l.meter === "runsUsd" ? `$${n.toFixed(2)}` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(Math.round(n)));
  return `${LABEL[l.meter][l.period]}: ${fmt(l.used)} de ${fmt(l.limit)} (${Math.round(l.ratio * 100)} %)`;
}

export class BudgetService {
  private cache: { at: number; tokens: Record<Period, number> } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: JsonStore,
    private runs: RunManager,
    private sessions: SessionIndex,
    private notify: (text: string, over: boolean) => Promise<void> | void,
  ) {}

  config(): BudgetConfig {
    return budgetConfigSchema.parse(this.store.read<unknown>(B, {}));
  }

  setConfig(body: unknown): BudgetConfig {
    const cfg = parse(budgetConfigSchema, body);
    this.store.write(B, cfg);
    return cfg;
  }

  private async tokenUsage(now: Date): Promise<Record<Period, number>> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.tokens;
    const today = now.toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const a = await this.sessions.analytics(now.getUTCDate());
    const tokens = { daily: 0, monthly: 0 };
    for (const d of a.days) {
      const n = d.input + d.output;
      if (d.date.startsWith(month)) tokens.monthly += n;
      if (d.date === today) tokens.daily += n;
    }
    this.cache = { at: Date.now(), tokens };
    return tokens;
  }

  async status(now = new Date()): Promise<BudgetStatus> {
    const config = this.config();
    const today = now.toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const usd = { daily: 0, monthly: 0 };
    for (const r of this.runs.list()) {
      if (!r.costUsd || !r.startedAt.startsWith(month)) continue;
      usd.monthly += r.costUsd;
      if (r.startedAt.startsWith(today)) usd.daily += r.costUsd;
    }
    const needTokens = config.tokens.daily !== null || config.tokens.monthly !== null;
    const usage = { runsUsd: usd, tokens: needTokens ? await this.tokenUsage(now) : { daily: 0, monthly: 0 } };
    const lines: BudgetLine[] = [];
    for (const meter of ["runsUsd", "tokens"] as Meter[]) {
      for (const period of ["daily", "monthly"] as Period[]) {
        const lim = config[meter][period];
        if (lim === null) continue;
        const used = usage[meter][period];
        const ratio = used / lim;
        lines.push({ meter, period, used, limit: lim, ratio, level: ratio >= 1 ? "over" : ratio >= config.warnAt ? "warn" : "ok" });
      }
    }
    const level: Level = lines.some((l) => l.level === "over") ? "over" : lines.some((l) => l.level === "warn") ? "warn" : "ok";
    const blocked = config.blockAutomation && lines.some((l) => l.meter === "runsUsd" && l.level === "over");
    return { config, usage, lines, level, blocked };
  }

  /** Throws when unattended runs (queue, schedules) must not start. */
  async assertAutomationAllowed() {
    const st = await this.status();
    if (st.blocked) throw new HttpError(402, "Presupuesto superado: las ejecuciones automáticas están en pausa (Analítica → Presupuesto)");
  }

  /** Send each warn/over alert once per period. Returns the lines alerted now. */
  async check(now = new Date()): Promise<BudgetLine[]> {
    const st = await this.status(now);
    const day = now.toISOString().slice(0, 10);
    const sent: BudgetLine[] = [];
    this.store.update<Record<string, string>>(ALERTS, {}, (seen) => {
      for (const l of st.lines) {
        if (l.level === "ok") continue;
        const key = `${l.meter}.${l.period}.${l.level}`;
        const periodKey = l.period === "daily" ? day : day.slice(0, 7);
        if (seen[key] === periodKey) continue;
        seen[key] = periodKey;
        sent.push(l);
      }
    });
    for (const l of sent) {
      const head = l.level === "over" ? "⛔ Presupuesto superado" : "⚠️ Cerca del presupuesto";
      const tail = l.level === "over" && st.blocked && l.meter === "runsUsd" ? " Las ejecuciones automáticas quedan en pausa." : "";
      await this.notify(`${head} · ${formatLine(l)}.${tail}`, l.level === "over");
    }
    return sent;
  }

  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check().catch((e) => console.error("[agentic] budgets", e)), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
