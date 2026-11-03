import { z } from "zod";
import type { RunManager, Run } from "./runs";
import type { JsonStore } from "./store";
import type { Task, TaskService } from "./tasks";
import { absPath, AGENT_NAME_RE, HttpError, MODEL_RE, nowIso, parse, PERMISSION_MODES } from "./util";

export const queueStartSchema = z.object({
  projectPath: absPath.nullable().optional(),
  // Unattended batches never get bypassPermissions: every tool call would run unchecked.
  permissionMode: z.enum(PERMISSION_MODES.filter((m) => m !== "bypassPermissions") as [string, ...string[]]).default("acceptEdits"),
  model: z.string().regex(MODEL_RE).optional().or(z.literal("").transform(() => undefined)),
  agent: z.string().regex(AGENT_NAME_RE).optional().or(z.literal("").transform(() => undefined)),
  limit: z.number().int().min(1).max(50).default(5),
  maxBudgetUsd: z.number().positive().max(1000).optional(),
  stopOnFailure: z.boolean().default(true),
});

export interface QueueState {
  running: boolean;
  config: z.infer<typeof queueStartSchema> | null;
  startedAt: string | null;
  finishedAt: string | null;
  processed: { taskId: string; runId: string; status: Run["status"] | "running" }[];
  currentRunId: string | null;
  stopReason: string | null;
}

const Q = "queue";
const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const idle = (): QueueState => ({ running: false, config: null, startedAt: null, finishedAt: null, processed: [], currentRunId: null, stopReason: null });

/**
 * Runs "To do" tasks one after another with Claude Code.
 * Deliberately conservative: one run at a time, a hard per-batch limit, stop on
 * first failure by default, and never resumes by itself after a restart.
 */
export class TaskQueue {
  constructor(
    private store: JsonStore,
    private tasks: TaskService,
    private runs: RunManager,
  ) {
    this.store.update<QueueState>(Q, idle(), (s) => {
      if (s.running) {
        s.running = false;
        s.currentRunId = null;
        s.finishedAt = nowIso();
        s.stopReason = "Agentic se reinició: la cola no se reanuda sola";
      }
    });
  }

  state(): QueueState {
    return this.store.read<QueueState>(Q, idle());
  }

  /** Tasks the queue would pick, in order. */
  pending(projectPath?: string | null): Task[] {
    const processed = new Set(this.state().processed.map((p) => p.taskId));
    return this.tasks
      .list()
      .filter((t) => t.status === "todo" && t.projectPath && (!projectPath || t.projectPath === projectPath) && !processed.has(t.id))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order);
  }

  private save(fn: (s: QueueState) => void) {
    return this.store.update<QueueState>(Q, idle(), fn);
  }

  async start(body: unknown): Promise<QueueState> {
    if (this.state().running) throw new HttpError(409, "La cola ya está en marcha");
    const config = parse(queueStartSchema, body);
    if (!this.pending(config.projectPath).length) throw new HttpError(400, "No hay tareas «To do» con proyecto para ejecutar");
    this.store.write<QueueState>(Q, { ...idle(), running: true, config, startedAt: nowIso() });
    await this.next();
    return this.state();
  }

  stop(reason = "Detenida por el usuario"): QueueState {
    // The current run keeps going; we simply don't start another one.
    return this.save((s) => {
      if (!s.running) return;
      s.running = false;
      s.finishedAt = nowIso();
      s.stopReason = reason;
    });
  }

  /** Called by the run manager whenever any run finishes. */
  async onRunFinished(run: Run) {
    const s = this.state();
    if (!s.running || s.currentRunId !== run.id) return;
    this.save((st) => {
      const p = st.processed.find((x) => x.runId === run.id);
      if (p) p.status = run.status;
      st.currentRunId = null;
    });
    if (run.status !== "completed" && s.config?.stopOnFailure) {
      this.stop(`La tarea falló (${run.status}); cola detenida`);
      return;
    }
    await this.next();
  }

  private async next() {
    const s = this.state();
    if (!s.running || !s.config) return;
    if (s.processed.length >= s.config.limit) {
      this.stop(`Límite de ${s.config.limit} tareas alcanzado`);
      return;
    }
    const task = this.pending(s.config.projectPath)[0];
    if (!task) {
      this.stop("No quedan tareas pendientes");
      return;
    }
    const checklist = task.checklist.length ? `\n\nChecklist:\n${task.checklist.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n")}` : "";
    try {
      const run = await this.runs.start({
        mode: "headless",
        projectPath: task.projectPath,
        prompt: task.prompt.trim() || `${task.title}\n\n${task.description}${checklist}`.trim(),
        permissionMode: s.config.permissionMode,
        model: s.config.model,
        agent: s.config.agent,
        maxBudgetUsd: s.config.maxBudgetUsd,
        taskId: task.id,
      });
      this.tasks.attachRun(task.id, run.id);
      this.save((st) => {
        st.processed.push({ taskId: task.id, runId: run.id, status: "running" });
        st.currentRunId = run.id;
      });
      // A run can finish before we recorded it as current (very fast failures).
      const latest = this.runs.get(run.id);
      if (latest.status !== "running") await this.onRunFinished(latest);
    } catch (e) {
      this.stop(`No se pudo lanzar «${task.title}»: ${(e as Error).message}`);
    }
  }
}
