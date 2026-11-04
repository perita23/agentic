import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git } from "./git";
import { HttpError } from "./util";

/**
 * One git worktree per task: Claude works on its own branch in its own folder,
 * so several tasks can run in parallel on the same repo without touching the
 * user's checkout. Worktrees live under ~/.agentic/worktrees (never inside the
 * repo) and branches are named agentic/<slug>-<id>.
 */
export interface TaskWorktree {
  /** Worktree root. */
  path: string;
  /** Where Claude runs: the project's folder inside the worktree (differs in monorepos). */
  cwd: string;
  branch: string;
  base: string | null;
  projectPath: string;
  createdAt: string;
}

export interface WorktreeStatus {
  exists: boolean;
  changedFiles: string[];
  ahead: number;
  commits: { hash: string; subject: string }[];
}

export function worktreesRoot(dataDir: string) {
  return path.join(dataDir, "worktrees");
}

export function slugify(title: string) {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "tarea";
}

export function worktreeNames(dataDir: string, projectPath: string, taskId: string, title: string) {
  const name = `${slugify(title)}-${taskId.slice(0, 8)}`;
  const repoDir = `${slugify(path.basename(projectPath))}-${crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 6)}`;
  return { branch: `agentic/${name}`, dir: path.join(worktreesRoot(dataDir), repoDir, name) };
}

async function mustGit(cwd: string, args: string[], what: string) {
  const out = await git(cwd, args, { timeout: 60_000 });
  if (out === null) throw new HttpError(400, what);
  return out;
}

export async function createWorktree(dataDir: string, projectPath: string, taskId: string, title: string): Promise<TaskWorktree> {
  const top = (await git(projectPath, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top) throw new HttpError(400, "El proyecto no es un repositorio git: no se puede crear un worktree");
  if ((await git(projectPath, ["rev-parse", "--verify", "--quiet", "HEAD"])) === null) throw new HttpError(400, "El repositorio no tiene ningún commit todavía");
  const { branch, dir } = worktreeNames(dataDir, projectPath, taskId, title);
  const base = (await git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() || null;
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const branchExists = (await git(projectPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) !== null;
  // A previous worktree for this task may have been removed while its branch was kept: reuse the branch.
  const args = branchExists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, "HEAD"];
  await mustGit(projectPath, args, `No se pudo crear el worktree (${branch})`);
  const root = fs.realpathSync(dir);
  const sub = path.relative(fs.realpathSync(top), fs.realpathSync(projectPath));
  const cwd = sub && !sub.startsWith("..") ? path.join(root, sub) : root;
  return { path: root, cwd: fs.existsSync(cwd) ? cwd : root, branch, base: base === "HEAD" ? null : base, projectPath, createdAt: new Date().toISOString() };
}

export async function worktreeStatus(wt: TaskWorktree): Promise<WorktreeStatus> {
  if (!fs.existsSync(wt.path)) return { exists: false, changedFiles: [], ahead: 0, commits: [] };
  const status = (await git(wt.path, ["status", "--porcelain", "--untracked-files=all"])) ?? "";
  const changedFiles = status
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3))
    .slice(0, 200);
  let commits: WorktreeStatus["commits"] = [];
  if (wt.base) {
    const log = (await git(wt.path, ["log", "--format=%h%x09%s", "-n", "50", `${wt.base}..HEAD`])) ?? "";
    commits = log
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, ...rest] = l.split("\t");
        return { hash, subject: rest.join("\t") };
      });
  }
  return { exists: true, changedFiles, ahead: commits.length, commits };
}

/** Remove the folder; the branch (and its commits) stays unless deleteBranch is set. */
export async function removeWorktree(wt: TaskWorktree, { deleteBranch = false } = {}) {
  if (fs.existsSync(wt.path)) await mustGit(wt.projectPath, ["worktree", "remove", "--force", wt.path], "No se pudo quitar el worktree");
  await git(wt.projectPath, ["worktree", "prune"]);
  if (deleteBranch) await git(wt.projectPath, ["branch", "-D", wt.branch]);
}
