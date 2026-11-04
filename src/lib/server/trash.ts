import fs from "node:fs";
import path from "node:path";
import { HttpError, nowIso, UUID_RE } from "./util";
import type { SessionIndex } from "./sessions";

const KEEP_DAYS = 30;

export interface TrashItem {
  id: string;
  title: string;
  cwd: string | null;
  deletedAt: string;
  sizeBytes: number;
}
interface Meta extends TrashItem {
  originalFile: string;
  hasData: boolean;
}

/**
 * Deleting a Claude Code session moves its transcript (and its side folder) to
 * ~/.agentic/trash for 30 days instead of erasing it, so it can be restored.
 * Sessions with a running Claude Code process are never touched.
 */
export class SessionTrash {
  constructor(
    private dataDir: string,
    private claudeHome: string,
    private sessions: SessionIndex,
  ) {}

  private root() {
    return path.join(this.dataDir, "trash", "sessions");
  }

  private dir(id: string) {
    if (!UUID_RE.test(id)) throw new HttpError(400, "invalid session id");
    return path.join(this.root(), id);
  }

  /** rename, falling back to copy + remove across devices. */
  private move(from: string, to: string) {
    try {
      fs.renameSync(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
  }

  remove(id: string): TrashItem {
    const trashDir = this.dir(id);
    const found = this.sessions.listFiles().find((f) => path.basename(f.file, ".jsonl") === id);
    if (!found) throw new HttpError(404, "Sesión no encontrada");
    if (this.sessions.active().some((a) => a.sessionId === id)) throw new HttpError(409, "La sesión está en marcha: ciérrala antes de borrarla");
    const info = this.sessions.list().find((s) => s.id === id);
    const side = path.join(path.dirname(found.file), id);
    const hasData = fs.existsSync(side) && fs.statSync(side).isDirectory();
    const meta: Meta = { id, title: info?.title ?? id, cwd: info?.cwd ?? null, deletedAt: nowIso(), sizeBytes: found.st.size, originalFile: found.file, hasData };
    fs.mkdirSync(trashDir, { recursive: true, mode: 0o700 });
    this.move(found.file, path.join(trashDir, "session.jsonl"));
    if (hasData) this.move(side, path.join(trashDir, "data"));
    fs.writeFileSync(path.join(trashDir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
    const { originalFile: _o, hasData: _h, ...item } = meta; // eslint-disable-line @typescript-eslint/no-unused-vars
    return item;
  }

  private readMeta(id: string): Meta {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(id), "meta.json"), "utf8"));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(404, "No está en la papelera");
    }
  }

  list(): TrashItem[] {
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(this.root());
    } catch {
      return [];
    }
    const out: TrashItem[] = [];
    const limit = Date.now() - KEEP_DAYS * 86_400_000;
    for (const id of ids) {
      if (!UUID_RE.test(id)) continue;
      try {
        const m = this.readMeta(id);
        if (new Date(m.deletedAt).getTime() < limit) {
          this.purge(id);
          continue;
        }
        out.push({ id: m.id, title: m.title, cwd: m.cwd, deletedAt: m.deletedAt, sizeBytes: m.sizeBytes });
      } catch {
        /* unreadable entry: leave it */
      }
    }
    return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  }

  restore(id: string) {
    const m = this.readMeta(id);
    const projects = path.resolve(this.claudeHome, "projects");
    const target = path.resolve(m.originalFile);
    if (!target.startsWith(projects + path.sep)) throw new HttpError(400, "Ruta de restauración no válida");
    if (fs.existsSync(target)) throw new HttpError(409, "Ya existe una sesión con ese id");
    const trashDir = this.dir(id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.move(path.join(trashDir, "session.jsonl"), target);
    if (m.hasData) this.move(path.join(trashDir, "data"), path.join(path.dirname(target), id));
    fs.rmSync(trashDir, { recursive: true, force: true });
  }

  purge(id: string) {
    this.readMeta(id);
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }

  purgeAll() {
    for (const i of this.list()) this.purge(i.id);
  }
}
