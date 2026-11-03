import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AGENT_NAME_RE, HttpError, MODEL_RE, parse, text } from "./util";

export interface Agent {
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  prompt: string;
  scope: "user" | "project";
  projectPath: string | null;
  path: string;
  updatedAt: string;
}

export const agentSchema = z.object({
  name: z.string().regex(AGENT_NAME_RE, "lowercase letters, digits and dashes only (max 64)"),
  description: text(1000).min(1),
  tools: z.array(z.string().regex(/^[A-Za-z0-9_*().:\- ]{1,200}$/, "invalid tool name")).max(100).default([]),
  model: z.string().regex(MODEL_RE, "invalid model").optional().or(z.literal("").transform(() => undefined)),
  prompt: text(100_000).min(1),
});
export type AgentInput = z.infer<typeof agentSchema>;

/** Minimal front-matter parser for the flat `key: value` YAML agents use. */
export function parseFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.slice(1, -1);
      }
    } else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1);
    meta[mm[1]] = v;
  }
  return { meta, body: m[2] };
}

/** Front-matter values are single-line; quote anything YAML could misread. */
function yamlValue(v: string): string {
  const s = v.replace(/[\r\n]+/g, " ").trim();
  return /^[\w ,.()/-]*$/.test(s) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ? s : JSON.stringify(s);
}

export function serializeAgent(a: AgentInput): string {
  const lines = ["---", `name: ${a.name}`, `description: ${yamlValue(a.description)}`];
  if (a.tools?.length) lines.push(`tools: ${yamlValue(a.tools.join(", "))}`);
  if (a.model) lines.push(`model: ${a.model}`);
  // A body line equal to `---` cannot break parsing: only the first block is front-matter.
  lines.push("---", "", a.prompt.trim(), "");
  return lines.join("\n");
}

/** CRUD for subagents in `~/.claude/agents` (user) and `<project>/.claude/agents`. */
export class AgentManager {
  constructor(public readonly claudeHome: string) {}

  dirFor(scope: string, projectPath?: string | null): string {
    if (scope === "user") return path.join(this.claudeHome, "agents");
    if (scope === "project") {
      if (!projectPath || !path.isAbsolute(projectPath)) throw new HttpError(400, "projectPath required for project scope");
      return path.join(projectPath, ".claude", "agents");
    }
    throw new HttpError(400, "scope must be user or project");
  }

  fileFor(scope: string, name: string, projectPath?: string | null): string {
    if (!AGENT_NAME_RE.test(name || "")) throw new HttpError(400, "invalid agent name");
    const dir = this.dirFor(scope, projectPath);
    const f = path.join(dir, `${name}.md`);
    if (path.dirname(f) !== dir) throw new HttpError(400, "invalid agent path"); // defence in depth
    return f;
  }

  private readDir(dir: string, scope: Agent["scope"], projectPath: string | null): Agent[] {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: Agent[] = [];
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const full = path.join(dir, f);
      try {
        const st = fs.lstatSync(full); // never follow symlinks out of the folder
        if (!st.isFile() || st.size > 512 * 1024) continue;
        const { meta, body } = parseFrontMatter(fs.readFileSync(full, "utf8"));
        out.push({
          name: path.basename(f, ".md"),
          description: meta.description || "",
          tools: meta.tools ? meta.tools.split(",").map((t) => t.trim()).filter(Boolean) : [],
          model: meta.model || null,
          prompt: body.trim(),
          scope,
          projectPath,
          path: full,
          updatedAt: st.mtime.toISOString(),
        });
      } catch {}
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  list(projectPaths: string[] = []): Agent[] {
    const out = this.readDir(this.dirFor("user"), "user", null);
    for (const p of projectPaths) out.push(...this.readDir(this.dirFor("project", p), "project", p));
    return out;
  }

  save(scope: string, body: unknown, projectPath: string | null, opts: { create: boolean; name?: string }): Agent {
    const a = parse(agentSchema, body);
    if (opts.name && opts.name !== a.name) throw new HttpError(400, "Renaming agents is not supported; create a new one");
    const f = this.fileFor(scope, a.name, projectPath);
    const exists = fs.existsSync(f);
    if (opts.create && exists) throw new HttpError(409, "An agent with that name already exists");
    if (!opts.create && !exists) throw new HttpError(404, "Agent not found");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, serializeAgent(a), { mode: 0o644 });
    return this.readDir(path.dirname(f), scope as Agent["scope"], projectPath).find((x) => x.name === a.name)!;
  }

  remove(scope: string, name: string, projectPath: string | null) {
    const f = this.fileFor(scope, name, projectPath);
    try {
      fs.unlinkSync(f);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Agent not found");
      throw e;
    }
  }
}
