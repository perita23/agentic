import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { classifyUrl, contextOf, extractLibraryLinks, type LibraryItem, type LibraryKind } from "../library";
import type { SessionIndex } from "./sessions";

interface Hit {
  url: string;
  kind: LibraryKind;
  title: string;
  at: string | null;
  cwd: string | null;
}

const HOSTS = /https:\/\/(?:claude\.ai|github\.com|bitbucket\.org|[\w-]+\.atlassian\.net|linear\.app|docs\.google\.com|(?:www\.)?notion\.(?:so|site)|(?:www\.)?figma\.com)/;

/** Text blocks of a transcript line (messages and tool results), where links can show up. */
function textsOf(o: { message?: { content?: unknown } }): string[] {
  const c = o.message?.content;
  if (typeof c === "string") return [c];
  if (!Array.isArray(c)) return [];
  const out: string[] = [];
  for (const b of c as { type?: string; text?: string; content?: unknown }[]) {
    if (b?.type === "text" && typeof b.text === "string") out.push(b.text);
    else if (b?.type === "tool_result") {
      if (typeof b.content === "string") out.push(b.content);
      else if (Array.isArray(b.content)) for (const x of b.content as { text?: string }[]) if (typeof x?.text === "string") out.push(x.text);
    }
  }
  return out;
}

async function scanFile(file: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes("https://") || !HOSTS.test(line)) continue;
    let o: { timestamp?: string; cwd?: string; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    for (const text of textsOf(o)) {
      for (const { url, kind } of extractLibraryLinks(text)) hits.push({ url, kind, title: contextOf(text, url), at: typeof o.timestamp === "string" ? o.timestamp : null, cwd: typeof o.cwd === "string" ? o.cwd : null });
    }
  }
  return hits;
}

/**
 * Index of the links found in Claude Code sessions. Files are scanned once and cached by
 * (mtime, size); newest sessions first and within a time budget, so the first call never blocks long.
 */
export class LibraryService {
  private cache = new Map<string, { mtime: number; size: number; hits: Hit[] }>();

  constructor(private sessions: SessionIndex) {}

  async list(budgetMs = 6000): Promise<{ items: LibraryItem[]; scanned: number; total: number }> {
    const files = this.sessions.listFiles().sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    const deadline = Date.now() + budgetMs;
    let scanned = 0;
    for (const { file, st } of files) {
      const c = this.cache.get(file);
      if (c && c.mtime === st.mtimeMs && c.size === st.size) {
        scanned++;
        continue;
      }
      if (Date.now() > deadline) continue;
      try {
        this.cache.set(file, { mtime: st.mtimeMs, size: st.size, hits: await scanFile(file) });
        scanned++;
      } catch {
        /* unreadable file: skip */
      }
    }
    const byUrl = new Map<string, LibraryItem & { _sessions: Set<string> }>();
    for (const { file } of files) {
      const c = this.cache.get(file);
      if (!c) continue;
      const sessionId = path.basename(file, ".jsonl");
      for (const h of c.hits) {
        let it = byUrl.get(h.url);
        if (!it) {
          it = { url: h.url, kind: classifyUrl(h.url) ?? h.kind, title: h.title, sessionId, cwd: h.cwd, at: h.at, mentions: 0, sessions: 0, _sessions: new Set() };
          byUrl.set(h.url, it);
        }
        it.mentions++;
        it._sessions.add(sessionId);
        if (h.at && (!it.at || h.at > it.at)) {
          it.at = h.at;
          it.sessionId = sessionId;
          it.cwd = h.cwd ?? it.cwd;
        }
        if (h.title.length > it.title.length) it.title = h.title;
      }
    }
    const items = [...byUrl.values()].map(({ _sessions, ...it }) => ({ ...it, sessions: _sessions.size }));
    items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    return { items, scanned, total: files.length };
  }
}
