import fs from "node:fs";
import path from "node:path";
import type { SlashCommand, SlashKind } from "../slash";
import type { ProjectService } from "./projects";

const MAX = 300;

/** description / argument-hint from the YAML frontmatter, else the first text line. */
function describe(file: string): { description: string; hint?: string } {
  let head = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(2048);
      head = buf.toString("utf8", 0, fs.readSync(fd, buf, 0, buf.length, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { description: "" };
  }
  const clean = (v: string) => v.trim().replace(/^["']|["']$/g, "").slice(0, 140);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  if (fm) {
    const d = /^description:\s*(.+)$/m.exec(fm[1]);
    const h = /^argument-hint:\s*(.+)$/m.exec(fm[1]);
    if (d) return { description: clean(d[1]), hint: h ? clean(h[1]) : undefined };
  }
  const body = (fm ? head.slice(fm[0].length) : head).split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  return { description: clean(body ?? "") };
}

function walk(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), depth + 1) : e.isFile() && e.name.endsWith(".md") ? [path.join(dir, e.name)] : []));
}

/** Claude Code's custom slash commands and skills (user and project), for the "/" menu. */
export class CommandService {
  constructor(
    private claudeHome: string,
    private projects: ProjectService,
  ) {}

  private commandsIn(root: string, kind: SlashKind): SlashCommand[] {
    const dir = path.join(root, "commands");
    return walk(dir).map((f) => ({ name: path.relative(dir, f).slice(0, -3).split(path.sep).join(":"), kind, ...describe(f) }));
  }

  private skillsIn(root: string): SlashCommand[] {
    const dir = path.join(root, "skills");
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      /* none */
    }
    return entries
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
      .map((e) => ({ name: e.name, kind: "skill" as const, ...describe(path.join(dir, e.name, "SKILL.md")) }));
  }

  list(projectPath?: string | null): SlashCommand[] {
    const roots: [string, "user" | "project"][] = [[this.claudeHome, "user"]];
    if (projectPath && this.projects.isKnown(projectPath)) roots.push([path.join(projectPath, ".claude"), "project"]);
    const seen = new Set<string>();
    const out: SlashCommand[] = [];
    // Project entries first: they override user ones with the same name.
    for (const [root, kind] of [...roots].reverse()) {
      for (const c of [...this.commandsIn(root, kind), ...this.skillsIn(root)]) {
        if (seen.has(c.name) || !/^[A-Za-z0-9][\w:.-]*$/.test(c.name)) continue;
        seen.add(c.name);
        out.push(c);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX);
  }
}
