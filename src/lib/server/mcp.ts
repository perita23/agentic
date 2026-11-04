import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ProjectService } from "./projects";
import { HttpError, parse, text } from "./util";

const execFileP = promisify(execFile);

/**
 * MCP servers of Claude Code, read from its own config files and changed only
 * through `claude mcp add/remove` (so Claude Code stays the source of truth):
 *  - user:    ~/.claude.json → mcpServers           (all projects)
 *  - local:   ~/.claude.json → projects[path].mcpServers (one project, private)
 *  - project: <project>/.mcp.json                   (shared through git)
 * Secret values (env vars, headers) never leave the server: only their names.
 */
export type McpScope = "user" | "local" | "project";

export interface McpServer {
  name: string;
  scope: McpScope;
  projectPath: string | null;
  type: "stdio" | "http" | "sse";
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
}

type RawServer = { type?: string; command?: string; args?: unknown[]; url?: string; env?: Record<string, unknown>; headers?: Record<string, unknown> };

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export const mcpAddSchema = z
  .object({
    name: z.string().regex(NAME_RE, "Nombre no válido (letras, números, . _ -)"),
    scope: z.enum(["user", "local", "project"]).default("user"),
    projectPath: z.string().max(4096).nullable().optional(),
    type: z.enum(["stdio", "http", "sse"]).default("stdio"),
    command: text(1000).trim().optional(),
    args: z.array(text(2000)).max(50).default([]),
    url: z.string().url().max(2000).optional(),
    env: z.record(z.string().regex(ENV_KEY_RE, "Variable no válida"), text(4000)).default({}),
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,100}$/, "Cabecera no válida"), text(4000)).default({}),
  })
  .superRefine((v, ctx) => {
    if (v.type === "stdio" && !v.command) ctx.addIssue({ code: "custom", path: ["command"], message: "Falta el comando" });
    if (v.type !== "stdio" && !v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Falta la URL" });
    if (v.url && !/^https?:\/\//.test(v.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "La URL debe ser http(s)" });
    if (v.scope !== "user" && !v.projectPath) ctx.addIssue({ code: "custom", path: ["projectPath"], message: "Elige un proyecto" });
  });
export type McpAdd = z.infer<typeof mcpAddSchema>;

/** argv for `claude mcp add` (never through a shell). */
export function buildMcpAddArgs(s: McpAdd): string[] {
  const args = ["mcp", "add", "--scope", s.scope];
  if (s.type !== "stdio") args.push("--transport", s.type);
  for (const [k, v] of Object.entries(s.env)) args.push("--env", `${k}=${v}`);
  for (const [k, v] of Object.entries(s.headers)) args.push("--header", `${k}: ${v}`);
  args.push(s.name);
  if (s.type === "stdio") args.push("--", s.command!, ...s.args);
  else args.push(s.url!);
  return args;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function normalize(name: string, raw: RawServer, scope: McpScope, projectPath: string | null): McpServer {
  const type = raw.type === "http" || raw.type === "sse" ? raw.type : raw.url ? "http" : "stdio";
  return {
    name,
    scope,
    projectPath,
    type,
    command: typeof raw.command === "string" ? raw.command : null,
    args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    url: typeof raw.url === "string" ? raw.url.replace(/\/\/[^/@\s]+@/, "//") : null,
    envKeys: raw.env && typeof raw.env === "object" ? Object.keys(raw.env) : [],
    headerKeys: raw.headers && typeof raw.headers === "object" ? Object.keys(raw.headers) : [],
  };
}

export class McpService {
  constructor(
    private claudeHome: string,
    private claudeBin: string,
    private projects: ProjectService,
  ) {}

  /** ~/.claude.json next to ~/.claude, or inside a custom CLAUDE_CONFIG_DIR. */
  configFile() {
    const inside = path.join(this.claudeHome, ".claude.json");
    if (fs.existsSync(inside)) return inside;
    return path.join(path.dirname(this.claudeHome), ".claude.json");
  }

  list(): McpServer[] {
    const out: McpServer[] = [];
    const cfg = readJson(this.configFile()) ?? {};
    const user = (cfg.mcpServers ?? {}) as Record<string, RawServer>;
    for (const [n, s] of Object.entries(user)) out.push(normalize(n, s, "user", null));
    const local = (cfg.projects ?? {}) as Record<string, { mcpServers?: Record<string, RawServer> }>;
    for (const [p, v] of Object.entries(local)) for (const [n, s] of Object.entries(v?.mcpServers ?? {})) out.push(normalize(n, s, "local", p));
    for (const proj of this.projects.list()) {
      if (!proj.exists) continue;
      const shared = readJson(path.join(proj.path, ".mcp.json"));
      for (const [n, s] of Object.entries((shared?.mcpServers ?? {}) as Record<string, RawServer>)) out.push(normalize(n, s, "project", proj.path));
    }
    return out.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
  }

  private cwdFor(scope: McpScope, projectPath?: string | null) {
    if (scope === "user") return os.homedir();
    if (!projectPath || !this.projects.isKnown(projectPath)) throw new HttpError(400, "Proyecto desconocido");
    return projectPath;
  }

  private async claude(args: string[], cwd: string) {
    try {
      const { stdout } = await execFileP(this.claudeBin, args, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      throw new HttpError(400, (err.stderr || err.message).trim().split("\n").slice(-3).join(" ").slice(0, 400) || "claude mcp falló");
    }
  }

  async add(body: unknown) {
    const s = parse(mcpAddSchema, body);
    if (this.list().some((x) => x.name === s.name && x.scope === s.scope && (s.scope === "user" || x.projectPath === s.projectPath))) throw new HttpError(409, `Ya existe un servidor «${s.name}» ahí`);
    await this.claude(buildMcpAddArgs(s), this.cwdFor(s.scope, s.projectPath));
    return { ok: true };
  }

  async remove(body: unknown) {
    const { name, scope, projectPath } = parse(z.object({ name: z.string().regex(NAME_RE), scope: z.enum(["user", "local", "project"]), projectPath: z.string().max(4096).nullable().optional() }), body);
    await this.claude(["mcp", "remove", "--scope", scope, name], this.cwdFor(scope, projectPath));
    return { ok: true };
  }
}
