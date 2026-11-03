import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encryption at rest for collections that hold credentials (AES-256-GCM).
 *
 * Key: in the macOS app it comes from the Keychain (Electron safeStorage) and is
 * handed to this process in memory, never written in clear. Elsewhere it is a
 * random key in ~/.agentic/data.key (0600). Older keys are kept as fallbacks so
 * data sealed with them can still be opened (and is re-sealed on next write).
 */
const SEALED = "agentic-sealed-v1";

export interface SealedFile {
  format: typeof SEALED;
  iv: string;
  tag: string;
  data: string;
}

export function isSealed(v: unknown): v is SealedFile {
  return !!v && typeof v === "object" && (v as SealedFile).format === SEALED;
}

export function seal(value: unknown, key: Buffer): SealedFile {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return { format: SEALED, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function unseal<T>(file: SealedFile, keys: Buffer[]): T {
  for (const key of keys) {
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
      d.setAuthTag(Buffer.from(file.tag, "base64"));
      const out = Buffer.concat([d.update(Buffer.from(file.data, "base64")), d.final()]);
      return JSON.parse(out.toString("utf8")) as T;
    } catch {}
  }
  throw new Error("no se pudo descifrar (la clave del Llavero ha cambiado)");
}

const g = globalThis as unknown as { __agenticDataKey?: string };

/** Keys to use, primary first. */
export function dataKeys(dataDir: string): Buffer[] {
  const keys: Buffer[] = [];
  if (g.__agenticDataKey && /^[0-9a-f]{64}$/.test(g.__agenticDataKey)) keys.push(Buffer.from(g.__agenticDataKey, "hex"));
  const f = path.join(dataDir, "data.key");
  try {
    const k = fs.readFileSync(f, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(k)) keys.push(Buffer.from(k, "hex"));
  } catch {}
  if (!keys.length) {
    const k = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(f, k, { mode: 0o600, flag: "wx" });
    keys.push(Buffer.from(k, "hex"));
  }
  return keys;
}
