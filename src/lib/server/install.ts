import { execFile, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { promisify } from "node:util";
import { HttpError } from "./util";

const execFileP = promisify(execFile);

/**
 * Installs missing tools (tmux, Claude Code) with the package manager found on
 * this machine. Only these fixed commands can ever run: no user input reaches
 * the command line, no shell is involved, one install at a time.
 */
export type Tool = "tmux" | "claude";
export type Manager = "brew" | "npm";

export const TOOLS: Record<Tool, { label: string; recipes: Partial<Record<Manager, string[]>> }> = {
  tmux: { label: "tmux", recipes: { brew: ["install", "tmux"] } },
  claude: { label: "Claude Code", recipes: { brew: ["install", "--cask", "claude-code"], npm: ["install", "-g", "@anthropic-ai/claude-code"] } },
};

// Homebrew is often missing from PATH for apps opened from the Dock.
const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/home/linuxbrew/.linuxbrew/bin/brew"];
const MAX_LOG = 64 * 1024;
const TIMEOUT = 15 * 60_000;

export interface InstallJob {
  id: string;
  tool: Tool;
  manager: Manager;
  command: string;
  status: "running" | "succeeded" | "failed";
  exitCode: number | null;
  log: string;
  startedAt: string;
  endedAt: string | null;
}

async function works(bin: string, args: string[]): Promise<boolean> {
  try {
    await execFileP(bin, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export class Installer {
  private jobs = new Map<string, InstallJob>();
  private child: ChildProcess | null = null;
  private managers: Promise<Partial<Record<Manager, string>>> | null = null;

  constructor(private readonly opts: { brewPaths?: string[]; npmBin?: string } = {}) {}

  /** Detected package managers and their binaries (cached; refreshed with `fresh`). */
  detect(fresh = false): Promise<Partial<Record<Manager, string>>> {
    if (!this.managers || fresh) {
      this.managers = (async () => {
        const found: Partial<Record<Manager, string>> = {};
        for (const p of this.opts.brewPaths ?? ["brew", ...BREW_PATHS]) {
          if ((p === "brew" || fs.existsSync(p)) && (await works(p, ["--version"]))) {
            found.brew = p;
            break;
          }
        }
        const npm = this.opts.npmBin ?? "npm";
        if (await works(npm, ["--version"])) found.npm = npm;
        return found;
      })();
    }
    return this.managers;
  }

  /** Which manager installs a tool here (Homebrew first), or null. */
  async plan(tool: Tool): Promise<{ manager: Manager; bin: string; args: string[]; command: string } | null> {
    const found = await this.detect();
    for (const manager of ["brew", "npm"] as const) {
      const args = TOOLS[tool].recipes[manager];
      const bin = found[manager];
      if (args && bin) return { manager, bin, args, command: [manager, ...args].join(" ") };
    }
    return null;
  }

  async options(): Promise<{ managers: Manager[]; tools: Record<Tool, { command: string | null }> }> {
    const found = await this.detect();
    const tools = {} as Record<Tool, { command: string | null }>;
    for (const t of Object.keys(TOOLS) as Tool[]) tools[t] = { command: (await this.plan(t))?.command ?? null };
    return { managers: Object.keys(found) as Manager[], tools };
  }

  get(id: string): InstallJob {
    const j = this.jobs.get(id);
    if (!j) throw new HttpError(404, "Instalación no encontrada");
    return j;
  }

  async start(tool: Tool): Promise<InstallJob> {
    if (!(tool in TOOLS)) throw new HttpError(400, "Herramienta desconocida");
    if (this.child) throw new HttpError(409, "Ya hay una instalación en curso");
    const plan = await this.plan(tool);
    if (!plan) throw new HttpError(400, `No hay ningún gestor de paquetes para instalar ${TOOLS[tool].label}. Instala Homebrew desde https://brew.sh`);

    const job: InstallJob = {
      id: crypto.randomUUID(),
      tool,
      manager: plan.manager,
      command: plan.command,
      status: "running",
      exitCode: null,
      log: `$ ${plan.command}\n`,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.jobs.set(job.id, job);
    const append = (d: Buffer | string) => {
      job.log += d.toString();
      if (job.log.length > MAX_LOG) job.log = "…\n" + job.log.slice(-MAX_LOG);
    };
    // Never prompt: Homebrew and npm read these; stdin is closed.
    const env = { ...process.env, NONINTERACTIVE: "1", HOMEBREW_NO_ENV_HINTS: "1", HOMEBREW_NO_COLOR: "1", NO_COLOR: "1", npm_config_yes: "true" };
    const child = spawn(plan.bin, plan.args, { env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    this.child = child;
    const timer = setTimeout(() => {
      append("\nTiempo de espera agotado; instalación cancelada.\n");
      child.kill("SIGTERM");
    }, TIMEOUT);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const finish = (code: number | null, err?: Error) => {
      if (job.status !== "running") return;
      clearTimeout(timer);
      if (err) append(`\n${err.message}\n`);
      job.exitCode = code;
      job.status = code === 0 ? "succeeded" : "failed";
      job.endedAt = new Date().toISOString();
      this.child = null;
    };
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code));
    return job;
  }
}
