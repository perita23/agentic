import os from "node:os";
import path from "node:path";

export interface Config {
  dataDir: string;
  claudeHome: string;
  claudeBin: string;
  maxConcurrentRuns: number;
  maxLogBytes: number;
}

const expand = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

export function getConfig(): Config {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    dataDir: path.resolve(expand(process.env.AGENTIC_HOME || "~/.agentic")),
    claudeHome: path.resolve(expand(process.env.CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || "~/.claude")),
    claudeBin: process.env.CLAUDE_BIN || "claude",
    maxConcurrentRuns: num(process.env.AGENTIC_MAX_RUNS, 4),
    maxLogBytes: num(process.env.AGENTIC_MAX_LOG_BYTES, 10 * 1024 * 1024),
  };
}
