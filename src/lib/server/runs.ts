import { spawn, execFile, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { git, SAFE_DIFF } from "./git";
import type { JsonStore } from "./store";
import { absPath, existingDir, HttpError, MODEL_RE, nowIso, parse, PERMISSION_MODES, text, UUID_RE, AGENT_NAME_RE } from "./util";

const execFileP = promisify(execFile);

export type RunStatus = "running" | "completed" | "failed" | "stopped" | "interrupted";

export interface Run {
  id: string;
  mode: "headless" | "tmux";
  projectPath: string;
  prompt: string;
  model: string | null;
  agent: string | null;
  permissionMode: string;
  resumeSessionId: string | null;
  taskId: string | null;
  status: RunStatus;
  pid: number | null;
  tmuxSession: string | null;
  sessionId: string | null;
  exitCode: number | null;
  costUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  resultText: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  logBytes: number;
  /** Repository state captured right before launch, used to show what the run changed. */
  git?: GitBaseline | null;
}

export interface GitBaseline {
  head: string;
  branch: string | null;
  preDirty: string[];
  preUntracked: string[];
  /** The untracked list could not be read (e.g. huge unignored folders): don't attribute new files to the run. */
  untrackedUnknown?: boolean;
}

export interface RunDiff {
  available: boolean;
  reason?: string;
  baseline?: GitBaseline;
  commits: { hash: string; subject: string }[];
  files: { file: string; status: string; additions: number | null; deletions: number | null; preExisting: boolean }[];
  newFiles: { file: string; content: string | null }[];
  patch: string;
  truncated: boolean;
}

const MAX_PATCH = 512 * 1024;
const MAX_LIST = 2000;
const MAX_UNTRACKED = 5000;
const UNTRACKED_OPTS = { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 };

const lines = (s: string | null) => (s ?? "").split("\n").filter(Boolean);

/** Capture HEAD, branch and pre-existing changes without modifying the repository. */
export async function captureBaseline(cwd: string): Promise<GitBaseline | null> {
  const head = (await git(cwd, ["rev-parse", "--verify", "HEAD"]))?.trim();
  if (!head) return null;
  const [branch, status, untracked] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=no"]),
    git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"], UNTRACKED_OPTS),
  ]);
  const z = (s: string | null) => (s ?? "").split("\0").filter(Boolean);
  const pre = z(untracked);
  // Huge or unreadable untracked sets (e.g. an unignored node_modules) are not stored:
  // runs.json is rewritten often, and a truncated list would misattribute files to the run.
  const unknown = untracked === null || pre.length > MAX_UNTRACKED;
  return {
    head,
    branch: branch?.trim() || null,
    preDirty: z(status).map((l) => l.slice(3)).slice(0, MAX_LIST),
    preUntracked: unknown ? [] : pre,
    ...(unknown ? { untrackedUnknown: true } : {}),
  };
}

export const runCreateSchema = z
  .object({
    mode: z.enum(["headless", "tmux"]).default("headless"),
    projectPath: absPath,
    prompt: text(50_000).default(""),
    model: z.string().regex(MODEL_RE, "invalid model").optional().or(z.literal("").transform(() => undefined)),
    agent: z.string().regex(AGENT_NAME_RE, "invalid agent name").optional().or(z.literal("").transform(() => undefined)),
    permissionMode: z.enum(PERMISSION_MODES).default("default"),
    resumeSessionId: z.string().regex(UUID_RE, "invalid session id").optional().or(z.literal("").transform(() => undefined)),
    taskId: z.uuid().optional(),
    maxBudgetUsd: z.number().positive().max(1000).optional(),
  })
  .refine((r) => r.mode === "tmux" || r.prompt.trim().length > 0, { message: "prompt is required for headless runs", path: ["prompt"] });
export type RunInput = z.infer<typeof runCreateSchema>;

export interface RunOptions {
  dataDir: string;
  claudeBin: string;
  maxConcurrent: number;
  maxLogBytes: number;
  onFinished?: (run: Run) => void;
}

const R = "runs";
const MAX_RUN_HISTORY = 500;

/** Build the argv passed to `claude` (never through a shell). */
export function buildClaudeArgs(input: RunInput): string[] {
  const args: string[] = [];
  if (input.mode === "headless") args.push("-p", "--output-format", "stream-json", "--verbose");
  if (input.model) args.push("--model", input.model);
  if (input.agent) args.push("--agent", input.agent);
  if (input.permissionMode && input.permissionMode !== "default") args.push("--permission-mode", input.permissionMode);
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  if (input.mode === "headless" && input.maxBudgetUsd) args.push("--max-budget-usd", String(input.maxBudgetUsd));
  // `--` ends option parsing: a prompt starting with "-" can never become a flag.
  if (input.prompt.trim()) args.push("--", input.prompt);
  return args;
}

/** Shell-quoted command (for display / copy only, never executed). */
export function shellQuote(args: string[]): string {
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

export async function hasTmux(): Promise<boolean> {
  try {
    await execFileP("tmux", ["-V"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Launches and supervises `claude` processes; logs NDJSON to `<dataDir>/runs/<id>.ndjson`. */
export class RunManager {
  private procs = new Map<string, ChildProcess>();
  readonly logDir: string;

  constructor(
    private store: JsonStore,
    private opts: RunOptions,
  ) {
    this.logDir = path.join(opts.dataDir, "runs");
    fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    // Headless runs belong to the process that spawned them; after a restart they are gone.
    this.store.update<Run[]>(R, [], (all) => {
      for (const r of all) {
        if (r.status === "running" && r.mode === "headless") {
          r.status = "interrupted";
          r.endedAt ??= nowIso();
          r.error ??= "Agentic se reinició mientras la ejecución estaba activa";
        }
      }
    });
  }

  list(): Run[] {
    return [...this.store.read<Run[]>(R, [])].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  get(id: string): Run {
    const r = this.store.read<Run[]>(R, []).find((x) => x.id === id);
    if (!r) throw new HttpError(404, "Run not found");
    return r;
  }

  private patch(id: string, p: Partial<Run>): Run | undefined {
    let out: Run | undefined;
    this.store.update<Run[]>(R, [], (all) => {
      const r = all.find((x) => x.id === id);
      if (r) out = Object.assign(r, p);
    });
    return out;
  }

  logFile(id: string) {
    if (!UUID_RE.test(id)) throw new HttpError(400, "invalid run id");
    return path.join(this.logDir, `${id}.ndjson`);
  }

  runningCount() {
    return [...this.procs.values()].length;
  }

  async start(body: unknown): Promise<Run> {
    const input = parse(runCreateSchema, body);
    const cwd = existingDir(input.projectPath);
    if (input.mode === "headless" && this.runningCount() >= this.opts.maxConcurrent)
      throw new HttpError(429, `Límite de ${this.opts.maxConcurrent} ejecuciones simultáneas alcanzado`);

    const run: Run = {
      id: crypto.randomUUID(),
      mode: input.mode,
      projectPath: cwd,
      prompt: input.prompt,
      model: input.model ?? null,
      agent: input.agent ?? null,
      permissionMode: input.permissionMode,
      resumeSessionId: input.resumeSessionId ?? null,
      taskId: input.taskId ?? null,
      status: "running",
      pid: null,
      tmuxSession: null,
      sessionId: input.resumeSessionId ?? null,
      exitCode: null,
      costUsd: null,
      durationMs: null,
      numTurns: null,
      resultText: null,
      error: null,
      startedAt: nowIso(),
      endedAt: null,
      logBytes: 0,
    };
    const args = buildClaudeArgs(input);
    run.git = await captureBaseline(cwd);

    if (input.mode === "tmux") {
      if (!(await hasTmux())) throw new HttpError(400, "tmux no está instalado");
      run.tmuxSession = `agentic-${run.id.slice(0, 8)}`;
      try {
        // Multiple args => tmux execs the command directly, no shell involved.
        await execFileP("tmux", ["new-session", "-d", "-s", run.tmuxSession, "-x", "200", "-y", "50", "-c", cwd, this.opts.claudeBin, ...args], {
          timeout: 10_000,
        });
      } catch (e) {
        throw new HttpError(500, `No se pudo iniciar tmux: ${(e as Error).message}`);
      }
      this.saveNew(run);
      return run;
    }

    const logPath = this.logFile(run.id);
    const log = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 });
    let bytes = 0;
    let truncatedLog = false;
    const writeLog = (obj: unknown) => {
      if (truncatedLog) return;
      const line = JSON.stringify(obj) + "\n";
      if (bytes + line.length > this.opts.maxLogBytes) {
        truncatedLog = true;
        log.write(JSON.stringify({ type: "agentic", subtype: "log_truncated" }) + "\n");
        return;
      }
      bytes += line.length;
      log.write(line);
    };

    let child: ChildProcess;
    try {
      child = spawn(this.opts.claudeBin, args, {
        cwd,
        env: { ...process.env, AGENTIC_RUN_ID: run.id },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (e) {
      log.end();
      throw new HttpError(500, `No se pudo lanzar claude: ${(e as Error).message}`);
    }
    run.pid = child.pid ?? null;
    this.saveNew(run);
    this.procs.set(run.id, child);
    writeLog({ type: "agentic", subtype: "start", args: [this.opts.claudeBin, ...args.slice(0, -1), "<prompt>"], cwd, at: run.startedAt });

    let buf = "";
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(line);
      } catch {
        writeLog({ type: "stdout", text: line.slice(0, 10_000) });
        return;
      }
      writeLog(o);
      if (o.type === "system" && o.subtype === "init" && typeof o.session_id === "string") this.patch(run.id, { sessionId: o.session_id });
      if (o.type === "result") {
        this.patch(run.id, {
          costUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : null,
          durationMs: typeof o.duration_ms === "number" ? o.duration_ms : null,
          numTurns: typeof o.num_turns === "number" ? o.num_turns : null,
          resultText: typeof o.result === "string" ? o.result.slice(0, 20_000) : null,
          sessionId: typeof o.session_id === "string" ? o.session_id : undefined,
          error: o.is_error ? String(o.result ?? o.subtype ?? "error").slice(0, 2000) : null,
        });
      }
    };
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 1_000_000) {
        onLine(buf);
        buf = "";
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => writeLog({ type: "stderr", text: chunk.slice(0, 10_000) }));

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null, err?: Error) => {
      if (finished) return;
      finished = true;
      if (buf.trim()) onLine(buf);
      this.procs.delete(run.id);
      const current = this.get(run.id);
      const stopped = current.status === "stopped";
      const status: RunStatus = stopped ? "stopped" : code === 0 && !current.error ? "completed" : "failed";
      const error = err ? `No se pudo ejecutar ${this.opts.claudeBin}: ${err.message}` : current.error || (status === "failed" ? `exit ${code ?? signal}` : null);
      writeLog({ type: "agentic", subtype: "exit", code, signal, at: nowIso() });
      log.end();
      const done = this.patch(run.id, { status, exitCode: code, endedAt: nowIso(), error, logBytes: bytes });
      if (done) this.opts.onFinished?.(done);
    };
    child.on("error", (e) => finish(null, null, e));
    child.on("close", (code, signal) => finish(code, signal));
    return this.get(run.id);
  }

  private saveNew(run: Run) {
    this.store.update<Run[]>(R, [], (all) => {
      all.push(run);
      // Keep history bounded; drop the oldest finished runs (and their logs).
      while (all.length > MAX_RUN_HISTORY) {
        const idx = all.findIndex((r) => r.status !== "running");
        if (idx < 0) break;
        const [old] = all.splice(idx, 1);
        fs.rm(path.join(this.logDir, `${old.id}.ndjson`), { force: true }, () => {});
      }
    });
  }

  async stop(id: string): Promise<Run> {
    const run = this.get(id);
    if (run.status !== "running") return run;
    if (run.mode === "tmux" && run.tmuxSession) {
      await execFileP("tmux", ["kill-session", "-t", run.tmuxSession], { timeout: 5000 }).catch(() => {});
      return this.patch(id, { status: "stopped", endedAt: nowIso() })!;
    }
    const child = this.procs.get(id);
    this.patch(id, { status: "stopped" });
    if (child) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (this.procs.get(id) === child) child.kill("SIGKILL");
      }, 5000).unref();
    } else {
      this.patch(id, { endedAt: nowIso() });
    }
    return this.get(id);
  }

  remove(id: string) {
    const run = this.get(id);
    if (run.status === "running") throw new HttpError(409, "Para la ejecución antes de borrarla");
    this.store.update<Run[]>(R, [], (all) => all.filter((r) => r.id !== id));
    fs.rmSync(this.logFile(id), { force: true });
  }

  /** Incremental log read: events from byte `offset`, only complete lines. */
  readLog(id: string, offset = 0, maxBytes = 256 * 1024) {
    const run = this.get(id);
    const f = this.logFile(id);
    let size = 0;
    try {
      size = fs.statSync(f).size;
    } catch {
      return { events: [], nextOffset: 0, status: run.status, run };
    }
    const start = Math.max(0, Math.min(offset, size));
    const len = Math.min(maxBytes, size - start);
    const buf = Buffer.alloc(len);
    if (len > 0) {
      const fd = fs.openSync(f, "r");
      try {
        fs.readSync(fd, buf, 0, len, start);
      } finally {
        fs.closeSync(fd);
      }
    }
    const lastNl = buf.lastIndexOf(0x0a);
    const usable = lastNl >= 0 ? buf.subarray(0, lastNl + 1) : Buffer.alloc(0);
    const events = usable
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { type: "stdout", text: l };
        }
      });
    return { events, nextOffset: start + usable.length, status: run.status, run };
  }

  /**
   * Server-Sent Events stream of a run's log. Each event's `id` is the byte
   * offset after it, so a reconnecting EventSource (Last-Event-ID) resumes
   * exactly where it stopped. Ends with `event: end` once the run is over and
   * the log is drained; aborts when the client goes away.
   */
  streamLog(id: string, offset: number, signal: AbortSignal, { pollMs = 250, heartbeatMs = 15_000 } = {}): ReadableStream<Uint8Array> {
    this.get(id); // 404 before opening the stream
    const enc = new TextEncoder();
    let pos = Math.max(0, offset);
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (s: string) => controller.enqueue(enc.encode(s));
        let lastBeat = Date.now();
        send(": connected\n\n");
        try {
          while (!signal.aborted) {
            const chunk = this.readLog(id, pos);
            if (chunk.events.length) {
              // One SSE event per log line; the final one carries the new offset as id.
              chunk.events.forEach((e, i) => send(`${i === chunk.events.length - 1 ? `id: ${chunk.nextOffset}\n` : ""}data: ${JSON.stringify(e)}\n\n`));
              pos = chunk.nextOffset;
              continue; // drain fast while there is backlog
            }
            if (chunk.status !== "running") {
              send(`event: end\ndata: ${JSON.stringify({ status: chunk.status })}\n\n`);
              break;
            }
            if (Date.now() - lastBeat > heartbeatMs) {
              send(": ping\n\n");
              lastBeat = Date.now();
            }
            await new Promise((r) => setTimeout(r, pollMs));
          }
        } catch {
          // run deleted mid-stream or client gone: just close
        }
        try {
          controller.close();
        } catch {}
      },
    });
  }

  /** Snapshot of a tmux pane + refresh liveness. */
  async capture(id: string) {
    const run = this.get(id);
    if (run.mode !== "tmux" || !run.tmuxSession) throw new HttpError(400, "Not a tmux run");
    try {
      const { stdout } = await execFileP("tmux", ["capture-pane", "-p", "-J", "-t", run.tmuxSession, "-S", "-300"], {
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return { text: stdout, alive: true, run };
    } catch {
      const r = run.status === "running" ? this.patch(id, { status: "completed", endedAt: nowIso() })! : run;
      return { text: "", alive: false, run: r };
    }
  }

  /** Send text (and Enter) to an interactive tmux session. */
  async sendKeys(id: string, input: string) {
    const run = this.get(id);
    if (run.mode !== "tmux" || !run.tmuxSession || run.status !== "running") throw new HttpError(400, "Run is not an active tmux session");
    // -l sends the string literally (no key-name interpretation).
    await execFileP("tmux", ["send-keys", "-t", run.tmuxSession, "-l", "--", input], { timeout: 5000 });
    await execFileP("tmux", ["send-keys", "-t", run.tmuxSession, "Enter"], { timeout: 5000 });
  }

  /** What changed in the repository since the run started. */
  async diff(id: string): Promise<RunDiff> {
    const run = this.get(id);
    const empty = { commits: [], files: [], newFiles: [], patch: "", truncated: false };
    if (!run.git) return { available: false, reason: "El proyecto no era un repositorio git al lanzar la ejecución.", ...empty };
    const cwd = run.projectPath;
    const base = run.git.head;
    if (!/^[0-9a-f]{40,64}$/.test(base)) return { available: false, reason: "Línea base inválida.", ...empty };
    if ((await git(cwd, ["cat-file", "-e", `${base}^{commit}`])) === null)
      return { available: false, reason: "El commit base ya no existe en el repositorio.", ...empty };

    const [numstat, nameStatus, log, untracked, patchRaw] = await Promise.all([
      git(cwd, ["diff", ...SAFE_DIFF, "--numstat", "-z", base, "--"]),
      git(cwd, ["diff", ...SAFE_DIFF, "--name-status", "-z", base, "--"]),
      git(cwd, ["log", "--format=%h%x1f%s", `${base}..HEAD`, "-n", "100"]),
      git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"], UNTRACKED_OPTS),
      git(cwd, ["diff", ...SAFE_DIFF, base, "--"], { maxBuffer: 8 * 1024 * 1024 }),
    ]);

    const statusOf = new Map<string, string>();
    const ns = (nameStatus ?? "").split("\0").filter(Boolean);
    for (let i = 0; i < ns.length; ) {
      const st = ns[i++];
      if (st.startsWith("R") || st.startsWith("C")) {
        i++; // old path
        statusOf.set(ns[i++], st[0]);
      } else statusOf.set(ns[i++], st);
    }
    const pre = new Set(run.git.preDirty);
    const files: RunDiff["files"] = [];
    const nz = (numstat ?? "").split("\0");
    for (let i = 0; i < nz.length; i++) {
      const rec = nz[i];
      if (!rec) continue;
      const [a, d, p] = rec.split("\t");
      let file = p;
      if (p === "") {
        // rename: "a\td\t" followed by old\0new\0
        i += 1;
        file = nz[++i];
      }
      if (!file) continue;
      files.push({
        file,
        status: statusOf.get(file) ?? "M",
        additions: a === "-" ? null : Number(a),
        deletions: d === "-" ? null : Number(d),
        preExisting: pre.has(file),
      });
    }

    const preUntracked = new Set(run.git.preUntracked);
    const added = run.git.untrackedUnknown ? [] : (untracked ?? "").split("\0").filter((f) => f && !preUntracked.has(f)).slice(0, 200);
    const newFiles = added.map((file) => {
      const full = path.join(cwd, file);
      let content: string | null = null;
      try {
        const st = fs.lstatSync(full);
        if (st.isFile() && st.size <= 64 * 1024) {
          const buf = fs.readFileSync(full);
          if (!buf.includes(0)) content = buf.toString("utf8");
        }
      } catch {}
      return { file, content };
    });

    const patch = patchRaw ?? "";
    return {
      available: true,
      baseline: run.git,
      commits: lines(log).map((l) => {
        const [hash, subject] = l.split("\x1f");
        return { hash, subject };
      }),
      files: files.slice(0, MAX_LIST),
      newFiles,
      patch: patch.length > MAX_PATCH ? patch.slice(0, MAX_PATCH) : patch,
      truncated: patch.length > MAX_PATCH,
    };
  }

  /** Mark tmux runs whose session has disappeared as completed. */
  async refreshTmux() {
    const running = this.list().filter((r) => r.mode === "tmux" && r.status === "running" && r.tmuxSession);
    await Promise.all(
      running.map(async (r) => {
        try {
          await execFileP("tmux", ["has-session", "-t", r.tmuxSession!], { timeout: 3000 });
        } catch {
          this.patch(r.id, { status: "completed", endedAt: nowIso() });
        }
      }),
    );
  }

  /** Kill every child we own (used on shutdown). */
  shutdown() {
    for (const c of this.procs.values()) c.kill("SIGTERM");
  }
}
