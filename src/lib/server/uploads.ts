import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { HttpError, parse } from "./util";

/** Images attached to chat messages. Stored privately; Claude reads them by path. */
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as const;
const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const KEEP_MS = 30 * 24 * 3600 * 1000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uploadSchema = z.object({
  mime: z.enum(Object.keys(TYPES) as [keyof typeof TYPES, ...(keyof typeof TYPES)[]]),
  data: z.string().min(8).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16),
});

export function uploadsDir(dataDir: string) {
  return path.join(dataDir, "uploads");
}

/** The real type of the bytes (never trust the declared one). */
export function sniffImage(b: Buffer): keyof typeof TYPES | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export function saveUpload(dataDir: string, body: unknown) {
  const input = parse(uploadSchema, body);
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "La imagen es demasiado grande (máx. 8 MB)");
  const real = sniffImage(bytes);
  if (!real || real !== input.mime) throw new HttpError(400, "El archivo no es una imagen válida (PNG, JPG, GIF o WebP)");
  const dir = uploadsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  pruneUploads(dir);
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(dir, `${id}.${TYPES[real]}`), bytes, { mode: 0o600 });
  return { id, mime: real, size: bytes.length };
}

export function findUpload(dataDir: string, id: string): { path: string; mime: string } | null {
  if (!ID_RE.test(id)) return null;
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    const p = path.join(uploadsDir(dataDir), `${id}.${ext}`);
    if (fs.existsSync(p)) return { path: p, mime };
  }
  return null;
}

function pruneUploads(dir: string, now = Date.now()) {
  try {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true });
    }
  } catch {}
}
