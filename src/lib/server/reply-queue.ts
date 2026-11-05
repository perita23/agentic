import crypto from "node:crypto";
import { z } from "zod";
import type { RunManager, Run } from "./runs";
import type { JsonStore } from "./store";
import { HttpError, MODEL_RE, parse, PERMISSION_MODES, text, UUID_RE } from "./util";

/**
 * Messages written while Claude is still working in a conversation. They wait here (on disk, per conversation)
 * and the next one is sent as soon as the current turn finishes successfully, in order. If the turn is stopped
 * or fails, the queue pauses: nothing is sent behind your back, and "send now" or removing is up to you.
 */
export interface QueuedReply {
  id: string;
  prompt: string;
  images?: string[];
  permissionMode: string;
  model?: string;
  createdAt: string;
}

const COLLECTION = "reply-queue";
const MAX_PER_THREAD = 10;

const schema = z.object({
  prompt: text(50_000).refine((s) => s.trim().length > 0, "El mensaje está vacío"),
  images: z.array(z.string().regex(UUID_RE)).max(6).optional(),
  // Never bypassPermissions from a queued message.
  permissionMode: z.enum(PERMISSION_MODES.filter((m) => m !== "bypassPermissions") as [string, ...string[]]).default("default"),
  model: z.string().regex(MODEL_RE).optional().or(z.literal("").transform(() => undefined)),
});

export class ReplyQueue {
  constructor(
    private store: JsonStore,
    private runs: RunManager,
  ) {}

  private key(runId: string) {
    const first = this.runs.get(runId);
    return first.threadId ?? first.id;
  }

  list(runId: string): QueuedReply[] {
    return this.store.read<Record<string, QueuedReply[]>>(COLLECTION, {})[this.key(runId)] ?? [];
  }

  private write(key: string, items: QueuedReply[]) {
    this.store.update<Record<string, QueuedReply[]>>(COLLECTION, {}, (all) => {
      if (items.length) all[key] = items;
      else delete all[key];
    });
  }

  /** Queue a message; if Claude is not working right now it is simply sent. */
  async add(runId: string, body: unknown): Promise<{ started?: Run; queue: QueuedReply[] }> {
    const input = parse(schema, body);
    const thread = this.runs.thread(runId);
    const latest = thread[thread.length - 1];
    if (latest.mode !== "headless") throw new HttpError(400, "Sólo las ejecuciones headless admiten mensajes en cola");
    if (latest.status !== "running") {
      const started = await this.runs.start({ mode: "headless", projectPath: latest.projectPath, prompt: input.prompt, images: input.images, continueRunId: latest.id, permissionMode: input.permissionMode, model: input.model });
      return { started, queue: this.list(runId) };
    }
    const key = this.key(runId);
    const items = this.list(runId);
    if (items.length >= MAX_PER_THREAD) throw new HttpError(409, `Máximo ${MAX_PER_THREAD} mensajes en cola`);
    items.push({ id: crypto.randomUUID(), prompt: input.prompt, images: input.images, permissionMode: input.permissionMode, model: input.model, createdAt: new Date().toISOString() });
    this.write(key, items);
    return { queue: items };
  }

  remove(runId: string, id: string) {
    const items = this.list(runId).filter((x) => x.id !== id);
    this.write(this.key(runId), items);
    return items;
  }

  /** Send the first queued message now (the conversation must be idle). */
  async sendNext(runId: string): Promise<{ started: Run | null; queue: QueuedReply[] }> {
    const key = this.key(runId);
    const items = this.list(runId);
    const next = items[0];
    if (!next) return { started: null, queue: items };
    const thread = this.runs.thread(runId);
    const latest = thread[thread.length - 1];
    if (latest.status === "running") throw new HttpError(409, "Claude sigue trabajando: el mensaje saldrá al terminar");
    // Take it out first so a slow start can never send it twice; put it back if starting fails.
    this.write(key, items.slice(1));
    try {
      const started = await this.runs.start({ mode: "headless", projectPath: latest.projectPath, prompt: next.prompt, images: next.images, continueRunId: latest.id, permissionMode: next.permissionMode, model: next.model });
      return { started, queue: this.list(runId) };
    } catch (e) {
      this.write(key, items);
      throw e;
    }
  }

  /** Called when a run finishes: a completed turn sends the next queued message; stopped/failed ones pause the queue. */
  async onRunFinished(run: Run) {
    if (run.status !== "completed" || run.mode !== "headless") return;
    if (!this.list(run.id).length) return;
    await this.sendNext(run.id);
  }
}
