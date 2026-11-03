import fs from "node:fs";
import path from "node:path";

/**
 * Append-only audit log of security-relevant actions in `<dataDir>/audit.log`
 * (JSON lines, 0600, rotated at 5 MB keeping one previous file). Never
 * contains secrets: callers pass identifiers, not tokens or message bodies.
 */
const MAX = 5 * 1024 * 1024;

export interface AuditEntry {
  at: string;
  event: string;
  detail?: Record<string, string | number | boolean | null>;
}

export function audit(dataDir: string, event: string, detail?: AuditEntry["detail"]) {
  try {
    const f = path.join(dataDir, "audit.log");
    try {
      if (fs.statSync(f).size > MAX) fs.renameSync(f, `${f}.1`);
    } catch {}
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...(detail ? { detail } : {}) }) + "\n";
    fs.appendFileSync(f, line, { mode: 0o600 });
  } catch (e) {
    console.warn("[agentic] audit log write failed:", (e as Error).message);
  }
}

/** Most recent entries first. */
export function readAudit(dataDir: string, limit = 200): AuditEntry[] {
  try {
    const lines = fs.readFileSync(path.join(dataDir, "audit.log"), "utf8").trim().split("\n");
    return lines
      .slice(-limit)
      .reverse()
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AuditEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Tighten permissions of the data directory: 0700 dirs, 0600 files (ours only). */
export function hardenDataDir(dataDir: string) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const walk = (dir: string, depth: number) => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(dir);
    } catch {
      return;
    }
    if (!st.isDirectory() || (uid !== null && st.uid !== uid)) return;
    if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
    if (depth > 2) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const s = fs.lstatSync(p);
      if (s.isSymbolicLink() || (uid !== null && s.uid !== uid)) continue;
      if (s.isDirectory()) walk(p, depth + 1);
      else if (s.isFile() && (s.mode & 0o077) !== 0) fs.chmodSync(p, 0o600);
    }
  };
  try {
    walk(dataDir, 0);
  } catch (e) {
    console.warn("[agentic] could not tighten data dir permissions:", (e as Error).message);
  }
}
