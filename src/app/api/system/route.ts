import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { route } from "@/lib/server/api";
import { hasTmux } from "@/lib/server/runs";

const execFileP = promisify(execFile);

export const GET = route(async ({ c }) => {
  let claudeVersion: string | null = null;
  try {
    const { stdout } = await execFileP(c.config.claudeBin, ["--version"], { timeout: 8000 });
    claudeVersion = stdout.trim().slice(0, 200);
  } catch {}
  return {
    dataDir: c.config.dataDir,
    claudeHome: c.config.claudeHome,
    claudeBin: c.config.claudeBin,
    claudeVersion,
    tmux: await hasTmux(),
    maxConcurrentRuns: c.config.maxConcurrentRuns,
    node: process.version,
    platform: process.platform,
  };
});
