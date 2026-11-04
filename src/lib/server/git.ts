import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Options that stop a hostile repository from running code through git.
 * Repo-local config (.git/config, .git/info/attributes) can define fsmonitor,
 * hooks, pagers, external diff drivers, textconv and clean/smudge filters, all
 * of which execute arbitrary commands during innocent-looking `status`/`diff`.
 */
const BASE_ARGS = [
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.pager=cat",
  "-c", "core.attributesFile=/dev/null",
  "-c", "diff.external=",
  "--no-optional-locks",
];

const ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  // Read .gitattributes from the empty tree, i.e. ignore the work tree's (git >= 2.42).
  GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  GIT_PAGER: "cat",
};

async function run(cwd: string, args: string[], timeout: number, maxBuffer: number, extraEnv: Record<string, string> = {}) {
  try {
    const { stdout } = await execFileP("git", args, { cwd, timeout, maxBuffer, env: { ...process.env, ...ENV, ...extraEnv } });
    return stdout;
  } catch (e) {
    // SHA-256 repositories have a different empty-tree id; filters are still neutralised.
    if (!/attr|tree/i.test(String((e as { stderr?: string }).stderr ?? ""))) throw e;
    const { GIT_ATTR_SOURCE: _ignored, ...env } = ENV; // eslint-disable-line @typescript-eslint/no-unused-vars
    const { stdout } = await execFileP("git", args, { cwd, timeout, maxBuffer, env: { ...process.env, ...env, ...extraEnv } });
    return stdout;
  }
}

const filterCache = new Map<string, { at: number; args: string[] }>();

/** `-c` overrides that neutralise every filter driver configured for this repo. */
async function filterOverrides(cwd: string): Promise<string[]> {
  const hit = filterCache.get(cwd);
  if (hit && Date.now() - hit.at < 30_000) return hit.args;
  let names: string[] = [];
  try {
    // Reading config never executes anything.
    const out = await run(cwd, [...BASE_ARGS, "config", "--get-regexp", "^filter\\."], 3000, 256 * 1024);
    names = [...new Set(out.split("\n").map((l) => /^filter\.(.+)\.[a-z]+ /i.exec(l)?.[1]).filter((n): n is string => !!n))];
  } catch {
    // exit code 1 = no filters configured
  }
  const args = names.flatMap((n) => ["-c", `filter.${n}.clean=`, "-c", `filter.${n}.smudge=`, "-c", `filter.${n}.process=`, "-c", `filter.${n}.required=false`]);
  filterCache.set(cwd, { at: Date.now(), args });
  return args;
}

/**
 * Like `git()` but throws an Error with git's own message (last lines of stderr).
 * `env` adds variables, e.g. GIT_CONFIG_COUNT/KEY_n/VALUE_n to pass a credential
 * header without putting it on the command line.
 */
export async function gitStrict(cwd: string, args: string[], { timeout = 60_000, maxBuffer = 2 * 1024 * 1024, env = {} as Record<string, string> } = {}): Promise<string> {
  try {
    return await run(cwd, [...BASE_ARGS, ...(await filterOverrides(cwd)), ...args], timeout, maxBuffer, env);
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const msg = (err.stderr || err.message).trim().split("\n").filter(Boolean).slice(-3).join(" ");
    throw new Error(msg.slice(0, 500) || "git falló");
  }
}

/** Run git hardened against hostile repos. Returns stdout, or null on any failure. */
export async function git(cwd: string, args: string[], { timeout = 4000, maxBuffer = 2 * 1024 * 1024 } = {}): Promise<string | null> {
  try {
    return await run(cwd, [...BASE_ARGS, ...(await filterOverrides(cwd)), ...args], timeout, maxBuffer);
  } catch {
    return null;
  }
}

/** Flags for every `git diff` we run: no external diff programs, no textconv. */
export const SAFE_DIFF = ["--no-ext-diff", "--no-textconv", "--no-color"];
