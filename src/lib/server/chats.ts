import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { RunManager } from "./runs";
import type { SessionIndex } from "./sessions";
import type { JsonStore } from "./store";
import { HttpError, MODEL_RE, nowIso, parse, text, UUID_RE } from "./util";

/**
 * Free chat with Claude, outside any project. Every message is a headless
 * `claude -p` run in a neutral folder (~/.agentic/chat) that resumes the same
 * Claude session, so the history is Claude Code's own transcript.
 */
export interface Chat {
  id: string;
  title: string;
  model: string | null;
  sessionId: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
}

const F = "chats";
const MAX_CHATS = 500;

const sendSchema = z.object({
  prompt: text(50_000).trim().min(1, "Escribe un mensaje"),
  model: z.string().regex(MODEL_RE).optional().or(z.literal("").transform(() => undefined)),
  /** Never bypassPermissions in a chat. */
  permissionMode: z.enum(["default", "plan", "acceptEdits", "auto"]).default("default"),
});
const patchSchema = z.object({ title: text(120).trim().min(1).optional(), pinned: z.boolean().optional() }).strict();

export function chatDir(dataDir: string) {
  return path.join(dataDir, "chat");
}

export class ChatService {
  constructor(
    private store: JsonStore,
    private runs: RunManager,
    private sessions: SessionIndex,
    private dataDir: string,
  ) {}

  private all(): Chat[] {
    return this.store.read<Chat[]>(F, []);
  }

  private save(fn: (chats: Chat[]) => void) {
    this.store.update<Chat[]>(F, [], (chats) => {
      fn(chats);
    });
  }

  private find(id: string): Chat {
    if (!UUID_RE.test(id)) throw new HttpError(400, "id no válido");
    const c = this.all().find((x) => x.id === id);
    if (!c) throw new HttpError(404, "Conversación no encontrada");
    return c;
  }

  /** Follow the Claude session id reported by the latest run (resuming can fork a new one). */
  private sync(chat: Chat): Chat {
    if (!chat.lastRunId) return chat;
    const run = this.runs.list().find((r) => r.id === chat.lastRunId);
    if (!run?.sessionId || run.sessionId === chat.sessionId) return chat;
    this.save((chats) => {
      const c = chats.find((x) => x.id === chat.id);
      if (c) c.sessionId = run.sessionId;
    });
    return { ...chat, sessionId: run.sessionId };
  }

  list() {
    const runs = new Map(this.runs.list().map((r) => [r.id, r]));
    return this.all()
      .map((c) => this.sync(c))
      .map((c) => ({ ...c, running: !!c.lastRunId && runs.get(c.lastRunId)?.status === "running" }))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string) {
    const chat = this.sync(this.find(id));
    const run = chat.lastRunId ? this.runs.list().find((r) => r.id === chat.lastRunId) : undefined;
    const transcript = chat.sessionId ? await this.sessions.transcript(chat.sessionId) : null;
    return {
      ...chat,
      running: run?.status === "running",
      activity: run?.status === "running" ? this.runs.activity(run.id) : null,
      error: run && run.status === "failed" ? run.error || run.resultText || "La respuesta falló" : null,
      pendingPrompt: run?.status === "running" && !transcript?.messages.some((m) => m.role === "user" && m.text.trim() === run.prompt.trim()) ? run.prompt : null,
      messages: (transcript?.messages ?? []).filter((m) => m.text.trim() || m.tools?.length),
    };
  }

  async create(body: unknown) {
    const { prompt, model, permissionMode } = parse(sendSchema, body);
    const now = nowIso();
    const chat: Chat = {
      id: crypto.randomUUID(),
      title: prompt.replace(/\s+/g, " ").slice(0, 80),
      model: model ?? null,
      sessionId: null,
      lastRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.save((chats) => {
      chats.unshift(chat);
      chats.splice(MAX_CHATS);
    });
    await this.send(chat.id, { prompt, model, permissionMode });
    return this.find(chat.id);
  }

  async send(id: string, body: unknown) {
    const { prompt, model, permissionMode } = parse(sendSchema, body);
    const chat = this.sync(this.find(id));
    const last = chat.lastRunId ? this.runs.list().find((r) => r.id === chat.lastRunId) : undefined;
    if (last?.status === "running") throw new HttpError(409, "Claude todavía está respondiendo");
    if (chat.lastRunId && !chat.sessionId) throw new HttpError(409, "La conversación aún se está iniciando; inténtalo en unos segundos");
    const dir = chatDir(this.dataDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const run = await this.runs.start({
      mode: "headless",
      projectPath: dir,
      prompt,
      model: model ?? chat.model ?? undefined,
      resumeSessionId: chat.sessionId ?? undefined,
      permissionMode,
    });
    this.save((chats) => {
      const c = chats.find((x) => x.id === id);
      if (!c) return;
      c.lastRunId = run.id;
      c.updatedAt = nowIso();
      if (model) c.model = model;
    });
    return { runId: run.id };
  }

  update(id: string, body: unknown) {
    this.find(id);
    const p = parse(patchSchema, body);
    this.save((chats) => {
      const c = chats.find((x) => x.id === id);
      if (c) Object.assign(c, p);
    });
    return this.find(id);
  }

  remove(id: string) {
    this.find(id);
    this.save((chats) => {
      const i = chats.findIndex((x) => x.id === id);
      if (i >= 0) chats.splice(i, 1);
    });
  }
}
