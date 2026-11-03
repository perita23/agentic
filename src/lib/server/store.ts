import fs from "node:fs";
import path from "node:path";

/**
 * Tiny JSON document store: one file per collection under `dir`.
 * Writes are atomic (temp file + fsync + rename) so a crash never leaves a
 * half-written document. All access is synchronous, which also serializes
 * writes inside the single Node process that owns the data directory.
 */
export class JsonStore {
  private cache = new Map<string, unknown>();

  constructor(public readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private file(name: string) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid collection name: ${name}`);
    return path.join(this.dir, `${name}.json`);
  }

  read<T>(name: string, fallback: T): T {
    if (this.cache.has(name)) return this.cache.get(name) as T;
    let value = fallback;
    const f = this.file(name);
    try {
      value = JSON.parse(fs.readFileSync(f, "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // Corrupt file: keep a copy for the user and start from the fallback.
        try {
          fs.copyFileSync(f, `${f}.corrupt-${Date.now()}`);
        } catch {}
        console.warn(`[agentic] ${name}.json unreadable (${(e as Error).message}); backup kept, starting fresh.`);
      }
    }
    this.cache.set(name, value);
    return value;
  }

  write<T>(name: string, value: T): T {
    const f = this.file(name);
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, f);
    this.cache.set(name, value);
    return value;
  }

  /** Read-modify-write. `fn` gets a deep copy; mutate it or return a new value. */
  update<T>(name: string, fallback: T, fn: (draft: T) => T | void): T {
    const draft = structuredClone(this.read(name, fallback));
    const next = fn(draft);
    return this.write(name, next === undefined ? draft : next);
  }
}
