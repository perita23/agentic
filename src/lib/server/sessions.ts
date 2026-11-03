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

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

type DayUsage = TokenCounts & { messages: number; models: Record<string, number>; tools: Record<string, number> };

interface FileUsage {
  cwd: string | null;
  byDay: Record<string, DayUsage>;
}

export interface Analytics {
  days: ({ date: string; sessions: number } & TokenCounts & { messages: number })[];
  byProject: { path: string; tokens: number; sessions: number }[];
  byModel: { model: string; tokens: number }[];
  tools: { name: string; count: number }[];
  totals: TokenCounts & { messages: number; sessions: number };
}

const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export const tokenTotal = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;

/**
 * Indexes Claude Code transcripts in `<claudeHome>/projects/<dir>/<id>.jsonl`
 * and live processes in `<claudeHome>/sessions/<pid>.json`. Summaries are
 * cached per file by (mtime, size), and only the head of each file is read.
 */
export class SessionIndex {
  private cache = new Map<string, { mtimeMs: number; size: number; summary: SessionSummary }>();
  private usageCache = new Map<string, { mtimeMs: number; size: number; usage: FileUsage }>();

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

  /** Every transcript file on disk with its stat. */
  private files(): { file: string; st: fs.Stats }[] {
    const out: { file: string; st: fs.Stats }[] = [];
    let dirs: fs.Dirent[];
    try {
      dirs = fs.readdirSync(this.projectsDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(this.projectsDir, d.name);
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {}
      for (const n of names) {
        if (!n.endsWith(".jsonl")) continue;
        const file = path.join(dir, n);
        try {
          const st = fs.lstatSync(file);
          if (st.isFile()) out.push({ file, st });
        } catch {}
      }
    }
    return out;
  }

  /** Token usage of one transcript, aggregated per UTC day. Cached by (mtime, size). */
  private async fileUsage(file: string, st: fs.Stats): Promise<FileUsage> {
    const hit = this.usageCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.usage;
    const u: FileUsage = { cwd: null, byDay: {} };
    const dayOf = (day: string) => (u.byDay[day] ??= { ...zero(), messages: 0, models: {}, tools: {} });
    const fallbackDay = new Date(st.mtimeMs).toISOString().slice(0, 10);
    const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"assistant"') && !line.includes('"user"')) continue; // cheap pre-filter
      let o: Line;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (!o || typeof o !== "object") continue;
      u.cwd ??= strOrNull(o.cwd);
      const day = typeof o.timestamp === "string" && /^\d{4}-\d{2}-\d{2}/.test(o.timestamp) ? o.timestamp.slice(0, 10) : fallbackDay;
      if (o.type === "assistant" && o.message) {
        const us = o.message.usage || {};
        const d = dayOf(day);
        const t = {
          input: Number(us.input_tokens) || 0,
          output: Number(us.output_tokens) || 0,
          cacheRead: Number(us.cache_read_input_tokens) || 0,
          cacheWrite: Number(us.cache_creation_input_tokens) || 0,
        };
        d.input += t.input;
        d.output += t.output;
        d.cacheRead += t.cacheRead;
        d.cacheWrite += t.cacheWrite;
        d.messages++;
        const model = strOrNull(o.message.model);
        if (model && model !== "<synthetic>") d.models[model] = (d.models[model] || 0) + tokenTotal(t);
        if (Array.isArray(o.message.content))
          for (const b of o.message.content as Block[]) if (b?.type === "tool_use" && typeof b.name === "string") d.tools[b.name] = (d.tools[b.name] || 0) + 1;
      } else if (isHumanPrompt(o)) {
        dayOf(day).messages++;
      }
    }
    this.usageCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, usage: u });
    return u;
  }

  /** Aggregated usage over the last `days` days (UTC), optionally for one project. */
  async analytics(days = 30, project?: string | null): Promise<Analytics> {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const dayMap = new Map<string, TokenCounts & { messages: number; sessions: Set<string> }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(end.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      dayMap.set(d, { ...zero(), messages: 0, sessions: new Set() });
    }
    const projects = new Map<string, { tokens: number; sessions: number }>();
    const models: Record<string, number> = {};
    const tools: Record<string, number> = {};
    const totals = { ...zero(), messages: 0, sessions: 0 };

    const files = this.files().filter(({ st }) => new Date(st.mtimeMs).toISOString().slice(0, 10) >= start);
    // Bounded concurrency: parse a few transcripts at a time.
    const queue = [...files];
    const usages: { file: string; u: FileUsage }[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) usages.push({ file: next.file, u: await this.fileUsage(next.file, next.st) });
      }),
    );

    for (const { file, u } of usages) {
      if (project && u.cwd !== project) continue;
      const id = path.basename(file, ".jsonl");
      let tokens = 0;
      let active = false;
      for (const [day, t] of Object.entries(u.byDay)) {
        const bucket = dayMap.get(day);
        if (!bucket) continue;
        active = true;
        bucket.input += t.input;
        bucket.output += t.output;
        bucket.cacheRead += t.cacheRead;
        bucket.cacheWrite += t.cacheWrite;
        bucket.messages += t.messages;
        bucket.sessions.add(id);
        tokens += tokenTotal(t);
        for (const [m, n] of Object.entries(t.models)) models[m] = (models[m] || 0) + n;
        for (const [name, n] of Object.entries(t.tools)) tools[name] = (tools[name] || 0) + n;
        totals.input += t.input;
        totals.output += t.output;
        totals.cacheRead += t.cacheRead;
        totals.cacheWrite += t.cacheWrite;
        totals.messages += t.messages;
      }
      if (!active) continue;
      totals.sessions++;
      const key = u.cwd ?? "(desconocido)";
      const p = projects.get(key) ?? { tokens: 0, sessions: 0 };
      p.tokens += tokens;
      p.sessions++;
      projects.set(key, p);
    }

    return {
      days: [...dayMap.entries()].map(([date, d]) => ({ date, input: d.input, output: d.output, cacheRead: d.cacheRead, cacheWrite: d.cacheWrite, messages: d.messages, sessions: d.sessions.size })),
      byProject: [...projects.entries()].map(([p, v]) => ({ path: p, ...v })).sort((a, b) => b.tokens - a.tokens),
      byModel: Object.entries(models).map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens),
      tools: Object.entries(tools).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15),
      totals,
    };
  }

  /**
   * Full-text search over prompts and Claude's replies, newest sessions first.
   * Bounded by a hit limit and a time budget so it stays responsive on huge histories.
   */
  async search(query: string, { limit = 50, budgetMs = 3000, project }: { limit?: number; budgetMs?: number; project?: string | null } = {}) {
    const q = query.trim().toLowerCase();
    const hits: { sessionId: string; title: string; cwd: string | null; role: "user" | "assistant"; snippet: string; timestamp: string | null }[] = [];
    if (q.length < 2) return { hits, partial: false, scanned: 0 };
    // Raw-line prefilter must match how the text appears inside JSON strings.
    const raw = JSON.stringify(q).slice(1, -1);
    const deadline = Date.now() + budgetMs;
    const files = this.files().sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    let scanned = 0;
    let partial = false;
    for (const { file, st } of files) {
      if (hits.length >= limit) break;
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      const summary = this.summarize(file, st);
      if (project && summary.cwd !== project) continue;
      scanned++;
      let perSession = 0;
      const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.toLowerCase().includes(raw)) continue;
        let o: Line;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        let role: "user" | "assistant" | null = null;
        let text = "";
        if (o?.type === "assistant" && !o.isSidechain) {
          role = "assistant";
          text = contentText(o.message?.content);
        } else if (isHumanPrompt(o)) {
          role = "user";
          text = contentText(o.message.content);
        }
        const idx = text.toLowerCase().indexOf(q);
        if (!role || idx < 0) continue;
        const start = Math.max(0, idx - 80);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, idx + q.length + 120).replace(/\s+/g, " ") + (idx + q.length + 120 < text.length ? "…" : "");
        hits.push({ sessionId: summary.id, title: summary.title, cwd: summary.cwd, role, snippet, timestamp: strOrNull(o.timestamp) });
        if (++perSession >= 3 || hits.length >= limit) {
          rl.close();
          break;
        }
      }
    }
    return { hits, partial, scanned };
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
