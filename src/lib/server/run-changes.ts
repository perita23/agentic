import fs from "node:fs";
import path from "node:path";
import { git, SAFE_DIFF } from "./git";

/** A file Claude changed, as shown in the chat at the moment it happened. */
export interface FileChange {
  path: string;
  status: "created" | "edited" | "deleted";
  add: number | null;
  del: number | null;
  /** Unified diff of the file against the start of the run (capped). */
  patch: string;
  truncated: boolean;
}

const MAX_FILES = 8;
const MAX_PATCH_LINES = 160;
const UNTRACKED_OPTS = { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 };

function cap(patch: string): { patch: string; truncated: boolean } {
  const lines = patch.split("\n");
  if (lines.length <= MAX_PATCH_LINES) return { patch, truncated: false };
  return { patch: lines.slice(0, MAX_PATCH_LINES).join("\n"), truncated: true };
}

/**
 * Watches a run's working tree: after a tool that can change files (a shell command, a subagent…) it compares
 * the tree with the previous look and reports the files that changed since, with their diff. This is what lets
 * the chat show changes made through the terminal (sed, python, tee…) right where they happened.
 */
export class ChangeWatcher {
  private seen = new Map<string, string>();
  private chain: Promise<void> = Promise.resolve();
  closed = false;

  constructor(
    private cwd: string,
    private base: string,
    private preUntracked: Set<string>,
    private emit: (after: string | null, files: FileChange[]) => void,
  ) {
    this.scan(null, false); // remember what the tree looks like before Claude acts
  }

  /** `report: false` only updates what is known (used after Edit/Write, which the chat already shows exactly). */
  scan(after: string | null, report: boolean) {
    this.chain = this.chain.then(() => this.look(after, report)).catch(() => {});
  }

  idle() {
    return this.chain;
  }

  private async look(after: string | null, report: boolean) {
    if (this.closed) return;
    const [numstat, nameStatus, untracked] = await Promise.all([
      git(this.cwd, ["diff", ...SAFE_DIFF, "--numstat", "-z", this.base, "--"], UNTRACKED_OPTS),
      git(this.cwd, ["diff", ...SAFE_DIFF, "--name-status", "-z", this.base, "--"], UNTRACKED_OPTS),
      git(this.cwd, ["ls-files", "-z", "--others", "--exclude-standard"], UNTRACKED_OPTS),
    ]);
    if (numstat === null) return;

    const statusOf = new Map<string, string>();
    const ns = (nameStatus ?? "").split("\0").filter(Boolean);
    for (let i = 0; i < ns.length; ) {
      const st = ns[i++];
      if (st.startsWith("R") || st.startsWith("C")) {
        i++;
        statusOf.set(ns[i++], st[0]);
      } else statusOf.set(ns[i++], st);
    }
    const now = new Map<string, { sig: string; add: number | null; del: number | null; status: FileChange["status"]; tracked: boolean }>();
    const nz = numstat.split("\0");
    for (let i = 0; i < nz.length; i++) {
      const rec = nz[i];
      if (!rec) continue;
      const [a, d, p] = rec.split("\t");
      let file = p;
      if (p === "") {
        i += 1;
        file = nz[++i];
      }
      if (!file) continue;
      const st = statusOf.get(file) ?? "M";
      now.set(file, { sig: this.sig(file, a, d), add: a === "-" ? null : Number(a), del: d === "-" ? null : Number(d), status: st === "A" ? "created" : st === "D" ? "deleted" : "edited", tracked: true });
    }
    for (const f of (untracked ?? "").split("\0").filter((x) => x && !this.preUntracked.has(x)).slice(0, 200)) {
      if (!now.has(f)) now.set(f, { sig: this.sig(f, "n", "n"), add: null, del: null, status: "created", tracked: false });
    }

    const changed = [...now].filter(([f, v]) => this.seen.get(f) !== v.sig);
    const changes: FileChange[] = [];
    if (report && !this.closed) {
      for (const [file, v] of changed.slice(0, MAX_FILES)) {
        const raw = v.tracked ? ((await git(this.cwd, ["diff", ...SAFE_DIFF, "-U3", this.base, "--", file], { maxBuffer: 4 * 1024 * 1024 })) ?? "") : this.newFilePatch(file);
        const { patch, truncated } = cap(raw);
        let add = v.add;
        let del = v.del;
        if (!v.tracked) {
          add = raw ? raw.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length : null;
          del = 0;
        }
        changes.push({ path: file, status: v.status, add, del, patch, truncated });
      }
    }
    // Remember the new state (files that went back to their original content simply drop out).
    this.seen = new Map([...now].map(([f, v]) => [f, v.sig]));
    if (changes.length && !this.closed) this.emit(after, changes);
  }

  /** Size and mtime tell when a file changed again even if its line counts did not. */
  private sig(file: string, a: string, d: string) {
    try {
      const st = fs.statSync(path.join(this.cwd, file));
      return `${a}/${d}/${st.size}/${Math.round(st.mtimeMs)}`;
    } catch {
      return `${a}/${d}/gone`;
    }
  }

  private newFilePatch(file: string): string {
    try {
      const full = path.join(this.cwd, file);
      const st = fs.lstatSync(full);
      if (!st.isFile() || st.size > 64 * 1024) return "";
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) return "";
      const lines = buf.toString("utf8").replace(/\n$/, "").split("\n");
      return [`--- /dev/null`, `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
    } catch {
      return "";
    }
  }
}
