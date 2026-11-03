import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { isPidAlive, truncate, UUID_RE } from "./util";

const HEAD_BYTES = 256 * 1024;

export interface SessionSummary {
  id: string;
  projectDir: string;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
  title: string;
  firstPrompt: string | null;
  model: string | null;
  startedAt: string | null;
  lastActivity: string;
  sizeBytes: number;
  active: boolean;
  status: string;
  pid?: number;
}

export interface ActiveProcess {
  pid: number;
  sessionId: string | null;
  cwd: string | null;
  name: string | null;
  status: string;
  kind: string | null;
  entrypoint: string | null;
  version: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  tools?: { name: string; input: string }[];
  timestamp?: string;
  model?: string;
}

type Block = { type?: string; text?: string; name?: string; input?: unknown };
type Line = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Plain text of a Claude message `content` (string or block array). */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Block[])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function isHumanPrompt(o: Line): boolean {
  if (o?.type !== "user" || !o.message || o.isMeta || o.isSidechain) return false;
  const c = o.message.content;
  if (Array.isArray(c) && c.some((b: Block) => b?.type === "tool_result")) return false;
  const t = contentText(c).trim();
  return !!t && !/^<(command-|local-command-|system-reminder)/.test(t);
}

const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Indexes Claude Code transcripts in `<claudeHome>/projects/<dir>/<id>.jsonl`
 * and live processes in `<claudeHome>/sessions/<pid>.json`. Summaries are
 * cached per file by (mtime, size), and only the head of each file is read.
 */
export class SessionIndex {
  private cache = new Map<string, { mtimeMs: number; size: number; summary: SessionSummary }>();

  constructor(public readonly claudeHome: string) {}

  get projectsDir() {
    return path.join(this.claudeHome, "projects");
  }

  findFile(sessionId: string): string | null {
    if (!UUID_RE.test(sessionId)) return null;
    let dirs: fs.Dirent[];
    try {
      dirs = fs.readdirSync(this.projectsDir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const f = path.join(this.projectsDir, d.name, `${sessionId}.jsonl`);
      try {
        if (fs.lstatSync(f).isFile()) return f;
      } catch {}
    }
    return null;
  }

  private summarize(file: string, st: fs.Stats): SessionSummary {
    const hit = this.cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { ...hit.summary };

    const s: SessionSummary = {
      id: path.basename(file, ".jsonl"),
      projectDir: path.basename(path.dirname(file)),
      cwd: null,
      gitBranch: null,
      version: null,
      title: "",
      firstPrompt: null,
      model: null,
      startedAt: null,
      lastActivity: new Date(st.mtimeMs).toISOString(),
      sizeBytes: st.size,
      active: false,
      status: "closed",
    };
    let customTitle: string | null = null;
    let summaryTitle: string | null = null;

    let buf = Buffer.alloc(0);
    try {
      const fd = fs.openSync(file, "r");
      try {
        buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size));
        fs.readSync(fd, buf, 0, buf.length, 0);
      } finally {
        fs.closeSync(fd);
      }
    } catch {}
    const lines = buf.toString("utf8").split("\n");
    if (st.size > HEAD_BYTES) lines.pop(); // possibly cut mid-line
    for (const line of lines) {
      if (!line.trim()) continue;
      let o: Line;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (!o || typeof o !== "object") continue;
      s.cwd ??= strOrNull(o.cwd);
      s.gitBranch ??= strOrNull(o.gitBranch);
      s.version ??= strOrNull(o.version);
      s.startedAt ??= strOrNull(o.timestamp);
      if (o.type === "summary" && typeof o.summary === "string") summaryTitle ??= o.summary;
      if (o.type === "custom-title" && typeof o.customTitle === "string") customTitle = o.customTitle;
      if (!s.firstPrompt && isHumanPrompt(o)) s.firstPrompt = truncate(contentText(o.message.content).trim(), 300);
      if (!s.model && o.type === "assistant") s.model = strOrNull(o.message?.model);
    }
    s.title = customTitle || summaryTitle || (s.firstPrompt ? truncate(s.firstPrompt.split("\n")[0], 120) : "(sin título)");
    this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, summary: s });
    return { ...s };
  }

  /** Every transcript on disk, newest first, annotated with live status. */
  list(): SessionSummary[] {
    const out: SessionSummary[] = [];
    let dirs: fs.Dirent[];
    try {
      dirs = fs.readdirSync(this.projectsDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(this.projectsDir, d.name);
      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const full = path.join(dir, f);
        try {
          const st = fs.lstatSync(full);
          if (st.isFile()) out.push(this.summarize(full, st));
        } catch {}
      }
    }
    const live = new Map(this.active().map((a) => [a.sessionId, a]));
    for (const s of out) {
      const a = live.get(s.id);
      if (a) Object.assign(s, { active: true, status: a.status, pid: a.pid });
    }
    return out.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
  }

  /** Claude Code processes that are running right now. */
  active(): ActiveProcess[] {
    const dir = path.join(this.claudeHome, "sessions");
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: ActiveProcess[] = [];
    for (const f of files) {
      if (!/^\d+\.json$/.test(f)) continue;
      let o: Line;
      try {
        o = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        continue;
      }
      if (!o || !isPidAlive(o.pid)) continue;
      out.push({
        pid: o.pid,
        sessionId: strOrNull(o.sessionId),
        cwd: strOrNull(o.cwd),
        name: strOrNull(o.name),
        status: strOrNull(o.status) ?? "unknown",
        kind: strOrNull(o.kind),
        entrypoint: strOrNull(o.entrypoint),
        version: strOrNull(o.version),
        startedAt: Number.isFinite(o.startedAt) ? new Date(o.startedAt).toISOString() : null,
        updatedAt: Number.isFinite(o.updatedAt) ? new Date(o.updatedAt).toISOString() : null,
      });
    }
    return out.sort((a, b) => ((a.updatedAt || "") < (b.updatedAt || "") ? 1 : -1));
  }

  /** Condensed transcript for the viewer (last `limit` messages). */
  async transcript(sessionId: string, limit = 400) {
    const file = this.findFile(sessionId);
    if (!file) return null;
    const summary = this.summarize(file, fs.statSync(file));
    const messages: TranscriptMessage[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const tools: Record<string, number> = {};
    let total = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let o: Line;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (!o || o.isSidechain) continue;
      if (o.type === "assistant" && o.message) {
        const u = o.message.usage || {};
        usage.input += Number(u.input_tokens) || 0;
        usage.output += Number(u.output_tokens) || 0;
        usage.cacheRead += Number(u.cache_read_input_tokens) || 0;
        usage.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
        const blocks: Block[] = Array.isArray(o.message.content) ? o.message.content : [];
        const t = contentText(blocks).trim();
        const toolUses = blocks
          .filter((b) => b?.type === "tool_use")
          .map((b) => {
            const name = String(b.name);
            tools[name] = (tools[name] || 0) + 1;
            return { name, input: truncate(JSON.stringify(b.input ?? {}), 600) };
          });
        if (!t && !toolUses.length) continue;
        total++;
        messages.push({ role: "assistant", text: truncate(t, 20_000), tools: toolUses, timestamp: o.timestamp, model: o.message.model });
      } else if (isHumanPrompt(o)) {
        total++;
        messages.push({ role: "user", text: truncate(contentText(o.message.content), 20_000), timestamp: o.timestamp });
      }
      if (messages.length > limit) messages.shift();
    }
    const live = this.active().find((a) => a.sessionId === sessionId);
    return {
      ...summary,
      active: !!live,
      status: live?.status ?? "closed",
      pid: live?.pid,
      messages,
      totalMessages: total,
      truncated: total > messages.length,
      usage,
      tools,
    };
  }
}
