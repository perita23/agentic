import fs from "node:fs";
import path from "node:path";
import { git } from "./git";

/** Project files for the "@" picker: tracked + untracked-not-ignored (git), or a bounded walk outside git. */
const TTL = 20_000;
const MAX_FILES = 40_000;
const cache = new Map<string, { at: number; files: string[] }>();
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "target", "__pycache__", ".venv", "venv", ".gradle", "out", "coverage"]);

function walk(root: string, rel = "", depth = 0, out: string[] = []): string[] {
  if (depth > 7 || out.length >= MAX_FILES) return out;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && !e.isSymbolicLink()) {
      if (!SKIP_DIRS.has(e.name)) walk(root, r, depth + 1, out);
    } else if (e.isFile()) out.push(r);
  }
  return out;
}

export async function projectFiles(cwd: string): Promise<string[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL) return hit.files;
  const raw = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { maxBuffer: 32 * 1024 * 1024, timeout: 10_000 });
  const files = (raw !== null ? raw.split("\0").filter(Boolean) : walk(cwd)).slice(0, MAX_FILES);
  // Folders too (parents of the files), so "@src/app/" works.
  const dirs = new Set<string>();
  for (const f of files) for (let i = f.indexOf("/"); i >= 0; i = f.indexOf("/", i + 1)) dirs.add(f.slice(0, i + 1));
  const all = [...[...dirs].slice(0, 5000), ...files];
  cache.set(cwd, { at: Date.now(), files: all });
  if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  return all;
}

/** Best matches first: basename prefix, basename contains, path contains, then in-order letters. */
export function searchFiles(files: string[], query: string, limit = 12): { path: string; dir: boolean }[] {
  const q = query.toLowerCase();
  const scored: { f: string; score: number }[] = [];
  for (const f of files) {
    const isDir = f.endsWith("/");
    const lower = f.toLowerCase();
    const base = (isDir ? f.slice(0, -1) : f).split("/").pop()!.toLowerCase();
    let score: number;
    if (!q) score = 1000 - f.length - (isDir ? 0 : 0);
    else if (base.startsWith(q)) score = 900 - base.length;
    else if (base.includes(q)) score = 700 - base.length;
    else if (lower.includes(q)) score = 500 - lower.length;
    else {
      let i = 0;
      for (const ch of lower) if (ch === q[i]) i++;
      if (i < q.length) continue;
      score = 200 - lower.length;
    }
    // Files before folders when otherwise equal; shallow before deep.
    scored.push({ f, score: score - (isDir ? 0.5 : 0) - f.split("/").length * 0.01 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ path: x.f, dir: x.f.endsWith("/") }));
}
