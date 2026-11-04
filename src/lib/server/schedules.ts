import crypto from "node:crypto";
import { z } from "zod";
import type { RunManager } from "./runs";
import type { JsonStore } from "./store";
import { describeWhen } from "@/lib/schedule-format";
import { absPath, AGENT_NAME_RE, HttpError, MODEL_RE, parse, PERMISSION_MODES, text } from "./util";

/**
 * Recurring Claude Code runs ("every weekday at 9:00, review open PRs").
 * They fire while Agentic is running; a run missed while it was closed is
 * caught up once at start if it is recent (CATCH_UP_MS), never replayed in bulk.
 */
const S = "schedules";
const CATCH_UP_MS = 6 * 3600_000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const whenSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), time: z.string().regex(TIME_RE, "Hora no válida (HH:MM)"), days: z.array(z.number().int().min(0).max(6)).min(1, "Elige al menos un día").max(7) }),
  z.object({ kind: z.literal("interval"), hours: z.number().int().min(1).max(168) }),
]);
export type When = z.infer<typeof whenSchema>;
export { describeWhen };

export const scheduleSchema = z.object({
  name: text(120).trim().min(1),
  enabled: z.boolean().default(true),
  projectPath: absPath,
  prompt: text(50_000).trim().min(1),
  when: whenSchema,
  // Unattended runs never get bypassPermissions.
  permissionMode: z.enum(PERMISSION_MODES.filter((m) => m !== "bypassPermissions") as [string, ...string[]]).default("default"),
  model: z.string().regex(MODEL_RE).optional().or(z.literal("").transform(() => undefined)),
  agent: z.string().regex(AGENT_NAME_RE).optional().or(z.literal("").transform(() => undefined)),
  maxBudgetUsd: z.number().positive().max(1000).optional(),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export type Schedule = ScheduleInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
};

/** Next fire time strictly after `from` (local time for daily schedules). */
export function nextRun(when: When, from: Date, anchor?: Date): Date {
  if (when.kind === "interval") {
    const step = when.hours * 3600_000;
    const base = anchor && anchor.getTime() <= from.getTime() ? anchor.getTime() : from.getTime();
    const n = Math.floor((from.getTime() - base) / step) + 1;
    return new Date(base + n * step);
  }
  const [h, m] = when.time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0);
    if (d.getTime() > from.getTime() && when.days.includes(d.getDay())) return d;
  }
  throw new HttpError(400, "No se pudo calcular la próxima ejecución");
}

export class ScheduleService {
  private timer: NodeJS.Timeout | null = null;
  /** Checked before unattended (not manual) runs, e.g. the spending budget. */
  guard: (() => Promise<void>) | null = null;

  constructor(
    private store: JsonStore,
    private runs: RunManager,
    private isKnownProject: (p: string) => boolean,
  ) {}

  list(): Schedule[] {
    return [...this.store.read<Schedule[]>(S, [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Schedule {
    const s = this.list().find((x) => x.id === id);
    if (!s) throw new HttpError(404, "Programación no encontrada");
    return s;
  }

  create(body: unknown, now = new Date()): Schedule {
    const input = parse(scheduleSchema, body);
    if (!this.isKnownProject(input.projectPath)) throw new HttpError(400, "Proyecto desconocido");
    const s: Schedule = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: input.enabled ? nextRun(input.when, now).toISOString() : null,
      lastRunAt: null,
      lastRunId: null,
      lastError: null,
    };
    this.store.update<Schedule[]>(S, [], (all) => {
      if (all.length >= 100) throw new HttpError(400, "Máximo 100 programaciones");
      all.push(s);
    });
    return s;
  }

  update(id: string, body: unknown, now = new Date()): Schedule {
    const prev = this.get(id);
    const { id: _i, createdAt: _c, updatedAt: _u, nextRunAt: _n, lastRunAt: _l, lastRunId: _r, lastError: _e, ...base } = prev; // eslint-disable-line @typescript-eslint/no-unused-vars
    const input = parse(scheduleSchema, { ...base, ...(body as object) });
    if (!this.isKnownProject(input.projectPath)) throw new HttpError(400, "Proyecto desconocido");
    return this.patch(id, (s) => {
      Object.assign(s, input);
      s.updatedAt = now.toISOString();
      s.nextRunAt = input.enabled ? nextRun(input.when, now).toISOString() : null;
    });
  }

  remove(id: string) {
    this.store.update<Schedule[]>(S, [], (all) => {
      const i = all.findIndex((x) => x.id === id);
      if (i < 0) throw new HttpError(404, "Programación no encontrada");
      all.splice(i, 1);
    });
  }

  private patch(id: string, fn: (s: Schedule) => void): Schedule {
    let out: Schedule | undefined;
    this.store.update<Schedule[]>(S, [], (all) => {
      const s = all.find((x) => x.id === id);
      if (!s) throw new HttpError(404, "Programación no encontrada");
      fn(s);
      out = { ...s };
    });
    return out!;
  }

  /** Launch now (manual "Ejecutar ahora", or a due tick). */
  async fire(id: string, now = new Date(), { manual = true } = {}): Promise<Schedule> {
    const s = this.get(id);
    try {
      if (!manual && this.guard) await this.guard();
      const run = await this.runs.start({ mode: "headless", projectPath: s.projectPath, prompt: s.prompt, model: s.model, agent: s.agent, permissionMode: s.permissionMode, maxBudgetUsd: s.maxBudgetUsd });
      return this.patch(id, (x) => {
        x.lastRunAt = now.toISOString();
        x.lastRunId = run.id;
        x.lastError = null;
        if (!manual && x.enabled) x.nextRunAt = nextRun(x.when, now, new Date(x.createdAt)).toISOString();
      });
    } catch (e) {
      const status = (e as HttpError).status;
      // Busy (concurrency limit): try again on the next tick instead of skipping.
      if (!manual && status === 429) throw e;
      const updated = this.patch(id, (x) => {
        x.lastError = (e as Error).message.slice(0, 500);
        if (!manual && x.enabled) x.nextRunAt = nextRun(x.when, now, new Date(x.createdAt)).toISOString();
      });
      if (manual) throw e;
      return updated;
    }
  }

  /** Fire every due schedule. Returns the ids that were launched (or failed). */
  async tick(now = new Date()): Promise<string[]> {
    const fired: string[] = [];
    for (const s of this.list()) {
      if (!s.enabled || !s.nextRunAt) continue;
      const due = new Date(s.nextRunAt).getTime();
      if (due > now.getTime()) continue;
      if (now.getTime() - due > CATCH_UP_MS) {
        // Missed long ago (Agentic was closed): skip to the next slot.
        this.patch(s.id, (x) => {
          x.nextRunAt = nextRun(x.when, now, new Date(x.createdAt)).toISOString();
          x.lastError = "Se saltó una ejecución porque Agentic estaba cerrada";
        });
        continue;
      }
      try {
        await this.fire(s.id, now, { manual: false });
        fired.push(s.id);
      } catch {
        // concurrency limit: retried next tick
      }
    }
    return fired;
  }

  start(intervalMs = 30_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((e) => console.error("[agentic] scheduler", e)), intervalMs);
    this.timer.unref();
    void this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
