import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { JsonStore } from "./store";
import { HttpError, parse } from "./util";

/** The vault is a folder of Markdown files: Claude writes notes there with its normal file tools. */
export const obsidianSchema = z.object({
  enabled: z.boolean().default(false),
  /** Absolute path of the vault (the folder that has `.obsidian` inside). */
  vaultPath: z.string().max(4096).default(""),
  /** Folder inside the vault where Claude may write (one subfolder per project is created in it). */
  folder: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,59}$/u, "Nombre de carpeta no válido")
    .refine((s) => !s.includes(".."), "Nombre de carpeta no válido")
    .default("Agentic"),
  /** "folder": Claude only sees the Agentic folder. "vault": it can also read (never write outside the folder) the whole vault. */
  scope: z.enum(["folder", "vault"]).default("folder"),
});
export type ObsidianConfig = z.infer<typeof obsidianSchema>;

const DEFAULTS: ObsidianConfig = { enabled: false, vaultPath: "", folder: "Agentic", scope: "folder" };

export interface ObsidianRun {
  /** Directory handed to Claude (`--add-dir`). */
  addDir: string;
  /** Permission rules so notes can be written without asking (only inside the Agentic folder). */
  allow: string[];
  /** Added to the system prompt. */
  hint: string;
  /** Folder of this project's notes. */
  projectDir: string;
}

export interface DetectedVault {
  name: string;
  path: string;
}

/** Vaults Obsidian knows about, from its own config file (empty when Obsidian is not installed). */
export function detectVaults(home = os.homedir(), platform = process.platform): DetectedVault[] {
  const file =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "obsidian", "obsidian.json")
      : platform === "win32"
        ? path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "obsidian", "obsidian.json")
        : path.join(home, ".config", "obsidian", "obsidian.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { vaults?: Record<string, { path?: unknown }> };
    return Object.values(raw.vaults ?? {})
      .map((v) => (typeof v?.path === "string" && path.isAbsolute(v.path) ? v.path : null))
      .filter((p): p is string => !!p && isVault(p))
      .map((p) => ({ name: path.basename(p), path: p }));
  } catch {
    return [];
  }
}

export function isVault(p: string): boolean {
  try {
    return fs.statSync(path.join(p, ".obsidian")).isDirectory();
  } catch {
    return false;
  }
}

/** A project's name as a folder name: letters, digits, spaces, dots, dashes. */
export function projectFolder(projectPath: string): string {
  const base = path.basename(projectPath.replace(/\/+$/, "")) || "General";
  const clean = base.replace(/[^\p{L}\p{N} _.-]/gu, "-").replace(/^[-.\s]+/, "").slice(0, 60);
  return clean && !clean.includes("..") ? clean : "General";
}

const MAX_NOTE_BYTES = 200 * 1024;
const MAX_SCAN_FILES = 3000;

/** A note path inside a root: relative, `.md`, no way out of the root (not even through a symlink). */
function resolveNote(root: string, rel: string): string {
  if (typeof rel !== "string" || !rel.trim() || rel.includes("\0") || path.isAbsolute(rel) || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) throw new HttpError(400, "Ruta de nota no válida");
  if (!/\.md$/i.test(rel)) throw new HttpError(400, "Solo se trabaja con notas Markdown (.md)");
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new HttpError(400, "Ruta de nota no válida");
  return full;
}

/** The real path must stay inside the root (a symlink in the vault must not lead out of it). */
function insideRoot(root: string, full: string): boolean {
  try {
    const real = fs.realpathSync(full);
    return real === root || real.startsWith(fs.realpathSync(root) + path.sep);
  } catch {
    return false;
  }
}

export class ObsidianService {
  constructor(
    private store: JsonStore,
    private home = os.homedir(),
  ) {}

  get(): ObsidianConfig {
    const r = obsidianSchema.safeParse(this.store.read<unknown>("obsidian", {}));
    return r.success ? r.data : DEFAULTS;
  }

  set(body: unknown): ObsidianConfig {
    const cur = this.get();
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const next = parse(obsidianSchema, { ...cur, ...input });
    if (next.vaultPath) {
      if (!path.isAbsolute(next.vaultPath) || next.vaultPath.includes("\0")) throw new HttpError(400, "La ruta de la bóveda debe ser absoluta");
      let real: string;
      try {
        real = fs.realpathSync(next.vaultPath);
      } catch {
        throw new HttpError(400, "Esa carpeta no existe");
      }
      if (!isVault(real)) throw new HttpError(400, "Esa carpeta no es una bóveda de Obsidian (no tiene una carpeta .obsidian dentro)");
      next.vaultPath = real;
    }
    if (next.enabled && !next.vaultPath) throw new HttpError(400, "Elige primero una bóveda");
    this.store.write("obsidian", next);
    return next;
  }

  status() {
    const c = this.get();
    return {
      config: c,
      vaults: detectVaults(this.home),
      ready: c.enabled && !!c.vaultPath && isVault(c.vaultPath),
      folderPath: c.vaultPath ? path.join(c.vaultPath, c.folder) : null,
    };
  }

  /** What a headless run needs to write notes, or null when the integration is off or the vault is gone. */
  forRun(projectPath: string): ObsidianRun | null {
    const c = this.get();
    if (!c.enabled || !c.vaultPath || !isVault(c.vaultPath)) return null;
    const folder = path.join(c.vaultPath, c.folder);
    const projectDir = path.join(folder, projectFolder(projectPath));
    try {
      fs.mkdirSync(projectDir, { recursive: true });
    } catch {
      return null;
    }
    const rule = `/${folder}/**`; // "//…" is how Claude Code writes an absolute path in a permission rule
    const readsAll = c.scope === "vault";
    const hint = [
      `Tienes acceso a la bóveda de Obsidian del usuario (${c.vaultPath}).`,
      `Ve guardando ahí, de forma breve y útil, la información relevante que aprendas o decidas durante esta sesión (decisiones, hallazgos, comandos que funcionan, enlaces, pendientes), como notas Markdown en «${projectDir}».`,
      "Una nota por tema, con frontmatter YAML (title, date, tags, project) y enlaces [[wikilink]] entre notas; si la nota ya existe, edítala en vez de duplicarla.",
      readsAll ? `Puedes leer el resto de la bóveda para enlazar notas, pero solo escribe dentro de «${folder}».` : `Solo puedes escribir dentro de «${path.join(c.vaultPath, c.folder)}».`,
      "No avises de cada nota mientras trabajas: al terminar, di en una línea qué notas has creado o actualizado.",
    ].join(" ");
    return { addDir: readsAll ? c.vaultPath : folder, allow: [`Edit(${rule})`, `Write(${rule})`], hint, projectDir };
  }

  /** Where Claude may read (the Agentic folder, or the whole vault when the setting allows it) and where it may write. */
  private roots() {
    const c = this.get();
    if (!c.enabled || !c.vaultPath || !isVault(c.vaultPath)) throw new HttpError(409, "Obsidian no está conectado: actívalo en Ajustes");
    const write = path.join(c.vaultPath, c.folder);
    return { vault: c.vaultPath, read: c.scope === "vault" ? c.vaultPath : write, write };
  }

  private markdownFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= MAX_SCAN_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue; // .obsidian, .trash, .git…
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && /\.md$/i.test(e.name)) out.push(p);
      }
    };
    walk(root);
    return out;
  }

  /** Notes (relative to the vault) whose name or text contains the query, with a line of context. */
  searchNotes(query: string, limit = 15) {
    const { vault, read } = this.roots();
    const q = query.trim().toLowerCase();
    if (!q) throw new HttpError(400, "Escribe algo que buscar");
    const hits: { path: string; modifiedAt: string; match: string }[] = [];
    for (const f of this.markdownFiles(read)) {
      if (hits.length >= limit) break;
      let text: string;
      try {
        const st = fs.statSync(f);
        if (st.size > MAX_NOTE_BYTES * 5 || !insideRoot(read, f)) continue;
        text = fs.readFileSync(f, "utf8");
        const rel = path.relative(vault, f);
        const line = text.split("\n").find((l) => l.toLowerCase().includes(q));
        if (line !== undefined || rel.toLowerCase().includes(q)) hits.push({ path: rel, modifiedAt: st.mtime.toISOString(), match: (line ?? "").trim().slice(0, 200) });
      } catch {}
    }
    return hits;
  }

  /** `rel` is relative to the vault, as `searchNotes` returns it. */
  readNote(rel: string) {
    const { vault, read } = this.roots();
    const full = resolveNote(vault, rel);
    if (!full.startsWith(read + path.sep) || !insideRoot(read, full)) throw new HttpError(403, "Esa nota está fuera de lo que Claude puede leer");
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      throw new HttpError(404, "La nota no existe");
    }
    if (!st.isFile() || st.size > MAX_NOTE_BYTES * 5) throw new HttpError(413, "La nota es demasiado grande");
    return { path: path.relative(vault, full), modifiedAt: st.mtime.toISOString(), text: fs.readFileSync(full, "utf8") };
  }

  /** Writes (or appends to) a note, only inside the Agentic folder. */
  writeNote(rel: string, content: string, append = false) {
    const { vault, write } = this.roots();
    const full = resolveNote(vault, rel);
    if (!full.startsWith(write + path.sep)) throw new HttpError(403, `Solo se puede escribir dentro de «${path.basename(write)}»`);
    if (Buffer.byteLength(content) > MAX_NOTE_BYTES) throw new HttpError(413, "La nota es demasiado grande (máx. 200 KB)");
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!insideRoot(write, path.dirname(full))) throw new HttpError(403, "Ruta no permitida");
    const existed = fs.existsSync(full);
    if (existed && !insideRoot(write, full)) throw new HttpError(403, "Ruta no permitida");
    if (append && existed) fs.appendFileSync(full, (content.startsWith("\n") ? "" : "\n") + content);
    else fs.writeFileSync(full, content, { mode: 0o600 });
    return { path: path.relative(vault, full), created: !existed, bytes: fs.statSync(full).size };
  }
}
