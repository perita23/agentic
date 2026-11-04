import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ProjectService } from "./projects";
import { HttpError, parse } from "./util";

/**
 * Claude Code permission rules (`permissions` in its settings files):
 *  - user:    ~/.claude/settings.json                (all projects)
 *  - project: <project>/.claude/settings.json        (shared through git)
 *  - local:   <project>/.claude/settings.local.json  (this machine only)
 * Only the `permissions` key is touched; every other setting is preserved.
 */
export type PermScope = "user" | "project" | "local";
export const DEFAULT_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;

/** `Tool` or `Tool(specifier)`, e.g. Bash(npm run test:*), Read(./.env), mcp__github. */
const RULE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,127}(\([^\n]{1,500}\))?$/;
const rule = z.string().trim().regex(RULE_RE, "Regla no válida: usa Herramienta o Herramienta(patrón)");
const rules = z.array(rule).max(500).default([]);

export const permissionsSchema = z.object({
  allow: rules,
  ask: rules,
  deny: rules,
  defaultMode: z.enum(DEFAULT_MODES).nullable().default(null),
  additionalDirectories: z.array(z.string().trim().min(1).max(4096)).max(50).default([]),
});
export type Permissions = z.infer<typeof permissionsSchema>;

const targetSchema = z.object({ scope: z.enum(["user", "project", "local"]).default("user"), projectPath: z.string().max(4096).nullable().optional() });

function uniq(list: string[]) {
  return [...new Set(list)];
}

/** Rules that appear in more than one list (deny wins in Claude Code, so it is worth a warning). */
export function conflicts(p: Permissions): string[] {
  const seen = new Map<string, number>();
  for (const r of [...uniq(p.allow), ...uniq(p.ask), ...uniq(p.deny)]) seen.set(r, (seen.get(r) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([r]) => r);
}

export class PermissionService {
  constructor(
    private claudeHome: string,
    private projects: ProjectService,
  ) {}

  file(scope: PermScope, projectPath?: string | null) {
    if (scope === "user") return path.join(this.claudeHome, "settings.json");
    if (!projectPath || !this.projects.isKnown(projectPath)) throw new HttpError(400, "Proyecto desconocido");
    return path.join(projectPath, ".claude", scope === "local" ? "settings.local.json" : "settings.json");
  }

  private readSettings(file: string): Record<string, unknown> {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return {};
    }
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      /* fallthrough */
    }
    // Never overwrite a file we can't understand.
    throw new HttpError(409, `${path.basename(file)} no es JSON válido; corrígelo a mano antes de editarlo aquí`);
  }

  get(query: unknown) {
    const { scope, projectPath } = parse(targetSchema, query);
    const file = this.file(scope, projectPath);
    const settings = this.readSettings(file);
    const raw = (settings.permissions ?? {}) as Record<string, unknown>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const mode = typeof raw.defaultMode === "string" && (DEFAULT_MODES as readonly string[]).includes(raw.defaultMode) ? (raw.defaultMode as Permissions["defaultMode"]) : null;
    const permissions: Permissions = { allow: strings(raw.allow), ask: strings(raw.ask), deny: strings(raw.deny), defaultMode: mode, additionalDirectories: strings(raw.additionalDirectories) };
    return { scope, projectPath: projectPath ?? null, file, exists: fs.existsSync(file), permissions, conflicts: conflicts(permissions) };
  }

  save(body: unknown) {
    const { scope, projectPath, permissions } = parse(targetSchema.extend({ permissions: permissionsSchema }), body);
    const file = this.file(scope, projectPath);
    const settings = this.readSettings(file);
    const prev = (settings.permissions ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...prev, allow: uniq(permissions.allow), ask: uniq(permissions.ask), deny: uniq(permissions.deny) };
    if (permissions.defaultMode) next.defaultMode = permissions.defaultMode;
    else delete next.defaultMode;
    if (permissions.additionalDirectories.length) next.additionalDirectories = uniq(permissions.additionalDirectories);
    else delete next.additionalDirectories;
    for (const k of ["allow", "ask", "deny"]) if (!(next[k] as string[]).length) delete next[k];
    if (Object.keys(next).length) settings.permissions = next;
    else delete settings.permissions;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    let mode = 0o644;
    try {
      mode = fs.statSync(file).mode & 0o777;
    } catch {
      /* new file */
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode });
    fs.renameSync(tmp, file);
    return this.get({ scope, projectPath });
  }
}
