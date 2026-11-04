import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { JsonStore } from "./store";
import { HttpError, parse } from "./util";

/**
 * Backups of Agentic's own data (tasks, templates, projects, schedules,
 * budgets, chat list, run history). Credentials are never included: the
 * integrations stay encrypted on this device and must be reconnected after a
 * restore on another machine. Automatic copies: one per day, last 7 kept.
 */
export const BACKUP_COLLECTIONS = ["tasks", "templates", "projects", "schedules", "budgets", "chats", "runs", "ui-state", "prefs"] as const;
/** Everything `wipe` removes (credentials included). Login (token, passkeys) is kept. */
const WIPE_COLLECTIONS = [...BACKUP_COLLECTIONS, "integrations", "oauth-apps", "queue", "budget-alerts"];
const KEEP = 7;
const NAME_RE = /^agentic-(\d{4}-\d{2}-\d{2})(-[a-z0-9-]+)?\.json$/;

export interface BackupFile {
  app: "agentic";
  format: 1;
  version: string;
  createdAt: string;
  collections: Partial<Record<(typeof BACKUP_COLLECTIONS)[number], unknown>>;
}

const backupSchema = z.object({
  app: z.literal("agentic", { message: "No es una copia de Agentic" }),
  format: z.literal(1),
  version: z.string().max(40),
  createdAt: z.string().max(40),
  collections: z.record(z.string(), z.unknown()),
});

export class BackupService {
  constructor(
    private store: JsonStore,
    private dataDir: string,
    private version: string,
  ) {}

  dir() {
    return path.join(this.dataDir, "backups");
  }

  snapshot(now = new Date()): BackupFile {
    const collections: BackupFile["collections"] = {};
    for (const name of BACKUP_COLLECTIONS) {
      const v = this.store.peek<unknown>(name);
      if (v !== undefined) collections[name] = v;
    }
    return { app: "agentic", format: 1, version: this.version, createdAt: now.toISOString(), collections };
  }

  /** Write a copy to ~/.agentic/backups (0600) and prune old automatic ones. */
  save(label = "", now = new Date()): string {
    fs.mkdirSync(this.dir(), { recursive: true, mode: 0o700 });
    const name = `agentic-${now.toISOString().slice(0, 10)}${label ? `-${label}` : ""}.json`;
    const file = path.join(this.dir(), name);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.snapshot(now)), { mode: 0o600 });
    fs.renameSync(tmp, file);
    this.prune();
    return name;
  }

  list() {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir()).filter((n) => NAME_RE.test(n));
    } catch {
      return [];
    }
    return names
      .map((name) => {
        const st = fs.statSync(path.join(this.dir(), name));
        return { name, size: st.size, createdAt: st.mtime.toISOString(), automatic: !NAME_RE.exec(name)![2] };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private prune() {
    for (const b of this.list().filter((x) => x.automatic).slice(KEEP)) fs.rmSync(path.join(this.dir(), b.name), { force: true });
  }

  /** Daily automatic copy (no-op when today's exists or there is nothing to save). */
  autoBackup(now = new Date()) {
    const today = `agentic-${now.toISOString().slice(0, 10)}.json`;
    if (fs.existsSync(path.join(this.dir(), today))) return null;
    if (!Object.keys(this.snapshot(now).collections).length) return null;
    return this.save("", now);
  }

  read(name: string): BackupFile {
    if (!NAME_RE.test(name)) throw new HttpError(400, "Nombre de copia no válido");
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(), name), "utf8"));
    } catch {
      throw new HttpError(404, "Copia no encontrada");
    }
  }

  /**
   * Replace Agentic's data with a backup. A safety copy of the current data is
   * saved first, so a restore can always be undone.
   */
  restore(body: unknown, hasRunningWork: boolean) {
    if (hasRunningWork) throw new HttpError(409, "Hay ejecuciones o una cola en marcha: espera a que terminen");
    const input = (body as { file?: unknown })?.file;
    const data = parse(backupSchema, typeof input === "string" ? this.read(input) : body);
    const restored: string[] = [];
    const safety = this.save("antes-de-restaurar");
    for (const name of BACKUP_COLLECTIONS) {
      const v = data.collections[name];
      if (v === undefined) continue;
      const okShape = name === "budgets" || name === "ui-state" || name === "prefs" ? v !== null && typeof v === "object" && !Array.isArray(v) : Array.isArray(v);
      if (!okShape) throw new HttpError(400, `La colección «${name}» de la copia no es válida`);
      let value = v;
      // Runs from a backup are history: none of them is running here.
      if (name === "runs") value = (v as { status?: string }[]).map((r) => (r?.status === "running" ? { ...r, status: "interrupted" } : r));
      this.store.write(name, value);
      restored.push(name);
    }
    return { restored, safetyCopy: safety };
  }

  /** Remove every collection, run logs and worktree folders. Keeps login and, unless asked, backups. */
  wipe({ includeBackups = false } = {}) {
    for (const name of WIPE_COLLECTIONS) this.store.drop(name);
    for (const sub of ["runs", "worktrees", ...(includeBackups ? ["backups"] : [])]) fs.rmSync(path.join(this.dataDir, sub), { recursive: true, force: true });
    fs.mkdirSync(path.join(this.dataDir, "runs"), { recursive: true, mode: 0o700 });
  }
}
