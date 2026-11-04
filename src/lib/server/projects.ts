import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { git } from "./git";
import type { SessionIndex } from "./sessions";
import type { JsonStore } from "./store";
import { absPath, existingDir, HttpError, nowIso, parse, text, redactUrl } from "./util";

export interface StoredProject {
  id: string;
  path: string;
  name: string;
  description: string;
  tags: string[];
  color: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItem {
  id: string | null;
  path: string;
  name: string;
  description: string;
  tags: string[];
  color: string;
  pinned: boolean;
  registered: boolean;
  exists: boolean;
  sessionCount: number;
  activeSessions: number;
  lastActivity: string | null;
}

const COLORS = ["blue", "green", "purple", "orange", "pink", "cyan", "yellow", "red"] as const;

export const projectCreateSchema = z.object({
  path: absPath,
  name: text(100).trim().optional(),
  description: text(2000).default(""),
  tags: z.array(text(40).trim().min(1)).max(20).default([]),
  color: z.enum(COLORS).optional(),
  pinned: z.boolean().default(false),
});
export const projectUpdateSchema = z
  .object({
    name: text(100).trim().min(1),
    description: text(2000),
    tags: z.array(text(40).trim().min(1)).max(20),
    color: z.enum(COLORS),
    pinned: z.boolean(),
  })
  .partial()
  .strict();

const P = "projects";

function readSmall(file: string, max = 64 * 1024): string | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return null;
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(Math.min(max, st.size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

const MARKERS: [string, string][] = [
  ["package.json", "JavaScript/TypeScript"],
  ["tsconfig.json", "TypeScript"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pom.xml", "Java"],
  ["build.gradle", "Java/Kotlin"],
  ["Gemfile", "Ruby"],
  ["composer.json", "PHP"],
  ["Package.swift", "Swift"],
  ["pubspec.yaml", "Dart"],
  ["mix.exs", "Elixir"],
  ["CMakeLists.txt", "C/C++"],
  ["Dockerfile", "Docker"],
];

function realOr(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export class ProjectService {
  constructor(
    private store: JsonStore,
    private sessions: SessionIndex,
    /** Folders Agentic uses internally (e.g. the chat folder): never listed as projects. */
    private hidden: string[] = [],
  ) {
    // Session cwds are real paths (e.g. /private/var on macOS): hide both spellings.
    this.hidden = [...new Set(hidden.flatMap((h) => [h, realOr(h)]))];
  }

  stored(): StoredProject[] {
    return this.store.read<StoredProject[]>(P, []);
  }

  /** Registered projects merged with every cwd seen in Claude Code sessions. */
  list(): ProjectListItem[] {
    const map = new Map<string, ProjectListItem>();
    const colorFor = (p: string) => COLORS[crypto.createHash("md5").update(p).digest()[0] % COLORS.length];
    for (const p of this.stored()) {
      map.set(p.path, { ...p, registered: true, exists: fs.existsSync(p.path), sessionCount: 0, activeSessions: 0, lastActivity: null });
    }
    for (const s of this.sessions.list()) {
      if (!s.cwd || this.hidden.some((h) => s.cwd === h || s.cwd!.startsWith(h + path.sep))) continue;
      let item = map.get(s.cwd);
      if (!item) {
        item = {
          id: null,
          path: s.cwd,
          name: path.basename(s.cwd) || s.cwd,
          description: "",
          tags: [],
          color: colorFor(s.cwd),
          pinned: false,
          registered: false,
          exists: fs.existsSync(s.cwd),
          sessionCount: 0,
          activeSessions: 0,
          lastActivity: null,
        };
        map.set(s.cwd, item);
      }
      item.sessionCount++;
      if (s.active) item.activeSessions++;
      if (!item.lastActivity || s.lastActivity > item.lastActivity) item.lastActivity = s.lastActivity;
    }
    return [...map.values()].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivity || "").localeCompare(a.lastActivity || "") || a.name.localeCompare(b.name),
    );
  }

  isKnown(p: string): boolean {
    return this.list().some((x) => x.path === p);
  }

  create(body: unknown): StoredProject {
    const d = parse(projectCreateSchema, body);
    const real = existingDir(d.path);
    if (this.stored().some((p) => p.path === real)) throw new HttpError(409, "Project already registered");
    const now = nowIso();
    const proj: StoredProject = {
      id: crypto.randomUUID(),
      path: real,
      name: d.name || path.basename(real) || real,
      description: d.description,
      tags: d.tags,
      color: d.color ?? COLORS[crypto.createHash("md5").update(real).digest()[0] % COLORS.length],
      pinned: d.pinned,
      createdAt: now,
      updatedAt: now,
    };
    this.store.update<StoredProject[]>(P, [], (all) => {
      if (all.length >= 1000) throw new HttpError(400, "Too many projects");
      all.push(proj);
    });
    return proj;
  }

  update(id: string, body: unknown): StoredProject {
    const patch = parse(projectUpdateSchema, body);
    let out: StoredProject | undefined;
    this.store.update<StoredProject[]>(P, [], (all) => {
      const p = all.find((x) => x.id === id);
      if (!p) throw new HttpError(404, "Project not found");
      Object.assign(p, patch, { updatedAt: nowIso() });
      out = p;
    });
    return out!;
  }

  remove(id: string) {
    this.store.update<StoredProject[]>(P, [], (all) => {
      const i = all.findIndex((x) => x.id === id);
      if (i < 0) throw new HttpError(404, "Project not found");
      all.splice(i, 1);
    });
  }

  /** Detailed info for a known project path (git, CLAUDE.md, scripts, stack). */
  async info(p: string) {
    const item = this.list().find((x) => x.path === p);
    if (!item) throw new HttpError(404, "Unknown project (register it first)");
    const exists = fs.existsSync(p) && fs.statSync(p).isDirectory();
    const base = { ...item, exists };
    if (!exists) return { ...base, git: null, claudeMd: null, readme: null, scripts: {}, stack: [], files: [] };

    let entries: string[] = [];
    try {
      entries = fs.readdirSync(p).slice(0, 500);
    } catch {}
    const set = new Set(entries);
    const stack = [...new Set(MARKERS.filter(([f]) => set.has(f)).map(([, l]) => l))];

    let scripts: Record<string, string> = {};
    let pkgInfo: { name?: string; version?: string; dependencies: number } | null = null;
    const pkgRaw = readSmall(path.join(p, "package.json"), 256 * 1024);
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw);
        if (pkg && typeof pkg.scripts === "object") scripts = Object.fromEntries(Object.entries(pkg.scripts).filter(([, v]) => typeof v === "string")) as Record<string, string>;
        pkgInfo = {
          name: typeof pkg.name === "string" ? pkg.name : undefined,
          version: typeof pkg.version === "string" ? pkg.version : undefined,
          dependencies: Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length,
        };
      } catch {}
    }

    let gitInfo = null;
    if (set.has(".git")) {
      const [branch, last, status, remotes, count] = await Promise.all([
        git(p, ["rev-parse", "--abbrev-ref", "HEAD"]),
        git(p, ["log", "-1", "--format=%H%x1f%s%x1f%an%x1f%cI"]),
        git(p, ["status", "--porcelain=v1", "--untracked-files=normal"]),
        git(p, ["remote", "-v"]),
        git(p, ["rev-list", "--count", "HEAD"]),
      ]);
      const [hash, subject, author, date] = (last || "").trim().split("\x1f");
      const changes = (status || "").split("\n").filter(Boolean);
      const recent = await git(p, ["log", "-10", "--format=%h%x1f%s%x1f%an%x1f%cI"]);
      gitInfo = {
        branch: branch?.trim() || null,
        lastCommit: hash ? { hash, subject, author, date } : null,
        changes: changes.length,
        changedFiles: changes.slice(0, 50).map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3) })),
        remotes: [...new Set((remotes || "").split("\n").filter(Boolean).map((l) => redactUrl(l.split(/\s+/).slice(0, 2).join(" "))))],
        commitCount: Number((count || "").trim()) || 0,
        recentCommits: (recent || "")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [h, s, a, d] = l.split("\x1f");
            return { hash: h, subject: s, author: a, date: d };
          }),
      };
    }

    return {
      ...base,
      git: gitInfo,
      claudeMd: readSmall(path.join(p, "CLAUDE.md")) ?? readSmall(path.join(p, ".claude", "CLAUDE.md")),
      readme: readSmall(path.join(p, "README.md"), 16 * 1024),
      scripts,
      package: pkgInfo,
      stack,
      files: entries.filter((e) => !e.startsWith(".") || [".claude", ".github"].includes(e)).sort().slice(0, 100),
    };
  }
}
