import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:\-[\]]{0,79}$/;
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const;

/** Parse with zod and turn failures into a 400 with readable details. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    throw new HttpError(400, issues[0] ?? "Invalid input", issues);
  }
  return r.data;
}

/** A safe single-line/multi-line text field: bounded, no NUL bytes. */
/** Drop credentials embedded in URLs (https://user:token@host/…) before showing them. */
export function redactUrl(s: string): string {
  return s.replace(/\b([a-z][\w+.-]*:\/\/)[^\s/@]+@/gi, "$1");
}

export const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !s.includes("\0"), "contains invalid characters");

export const absPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes("\0"), "contains invalid characters")
  .refine((s) => path.isAbsolute(s), "must be an absolute path")
  .transform((s) => path.resolve(s));

/** Validate that a path is an existing directory (resolving symlinks). */
export function existingDir(p: string): string {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    throw new HttpError(400, `Directory does not exist: ${p}`);
  }
  if (!st.isDirectory()) throw new HttpError(400, `Not a directory: ${p}`);
  return fs.realpathSync(p);
}

export function isPidAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Render `{{var}}` placeholders. Unknown variables become empty strings. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : "",
  );
}

export function truncate(s: unknown, n: number): string {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const nowIso = () => new Date().toISOString();
