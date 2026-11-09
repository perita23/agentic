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
  /** Talk mode: the answer will be heard, not read. */
  voice: z.boolean().optional(),
});

/** What Claude is told in talk mode: short, spoken answers that can start being read at once. */
export const VOICE_HINT = "Esta conversación es por voz: tu respuesta se va a escuchar, no a leer. Responde de forma breve, natural y directa, con frases cortas y completas, como si hablaras con la persona (empieza por lo importante). Sin Markdown, listas, tablas ni emojis. No leas código, rutas ni URL: di qué hace o resume. Si hace falta mucho detalle, da lo esencial y ofrece ampliarlo.";
const patchSchema = z.object({ title: text(120).trim().min(1).optional(), pinned: z.boolean().optional() }).strict();

/** The path of a file Claude wrote with its Write tool, read from the (possibly cut) JSON of the tool call. */
export function writtenPath(toolInput: string, base: string): string | null {
  const m = /"file_path":\s*"((?:[^"\\]|\\.)*)"/.exec(toolInput);
  if (!m) return null;
  try {
    const p = JSON.parse(`"${m[1]}"`) as string;
    return path.isAbsolute(p) ? path.normalize(p) : path.resolve(base, p);
  } catch {
    return null;
  }
}

export interface ChatFile {
  path: string;
  name: string;
  size: number;
}

const MAX_DOWNLOAD = 200 * 1024 * 1024;

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
      live: run?.status === "running" ? { ...this.runs.liveStats(run.id), startedAt: run.startedAt } : null,
      error: run && run.status === "failed" ? run.error || run.resultText || "La respuesta falló" : null,
      pendingPrompt: run?.status === "running" && !transcript?.messages.some((m) => m.role === "user" && m.text.trim() === run.prompt.trim()) ? run.prompt : null,
      messages: (transcript?.messages ?? []).filter((m) => m.text.trim() || m.tools?.length).map((m) => (m.role === "assistant" ? { ...m, files: this.filesOf(m.tools) } : m)),
    };
  }

  /** The files Claude created in a message (its Write calls) that are still there, to offer them for download. */
  private filesOf(tools: { name: string; input: string }[] | undefined): ChatFile[] {
    const out = new Map<string, ChatFile>();
    for (const t of tools ?? []) {
      if (t.name !== "Write") continue;
      const p = writtenPath(t.input, chatDir(this.dataDir));
      if (!p || out.has(p)) continue;
      try {
        const st = fs.lstatSync(p);
        if (st.isFile()) out.set(p, { path: p, name: path.basename(p), size: st.size });
      } catch {
        // it was deleted or moved since
      }
    }
    return [...out.values()];
  }

  /**
   * A file of this chat to download: only one that Claude itself wrote in this conversation (a Write call in its
   * transcript), still a plain file (never a link to somewhere else), and not enormous. Nothing else is ever served.
   */
  async fileFor(id: string, requested: string): Promise<ChatFile> {
    const chat = this.sync(this.find(id));
    const transcript = chat.sessionId ? await this.sessions.transcript(chat.sessionId, 100_000) : null;
    const want = path.normalize(requested);
    for (const m of transcript?.messages ?? []) {
      if (m.role !== "assistant") continue;
      for (const f of this.filesOf(m.tools)) {
        if (f.path !== want) continue;
        if (f.size > MAX_DOWNLOAD) throw new HttpError(413, "El archivo es demasiado grande para descargarlo desde aquí");
        return f;
      }
    }
    throw new HttpError(404, "Ese archivo no es de esta conversación");
  }

  async create(body: unknown) {
    const { prompt, model, permissionMode, voice } = parse(sendSchema, body);
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
    await this.send(chat.id, { prompt, model, permissionMode, voice });
    return this.find(chat.id);
  }

  async send(id: string, body: unknown) {
    const { prompt, model, permissionMode, voice } = parse(sendSchema, body);
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
      appendPrompt: voice ? VOICE_HINT : undefined,
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
