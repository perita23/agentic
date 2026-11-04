import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";
import { removeWorktree, worktreeStatus } from "@/lib/server/worktrees";

/** The task's worktree: branch, uncommitted files and commits on top of the base branch. */
export const GET = route(async ({ c, params }) => {
  const task = c.tasks.get(params.id);
  if (!task.worktree) return { worktree: null, status: null };
  return { worktree: task.worktree, status: await worktreeStatus(task.worktree) };
});

/** Remove the worktree folder. The branch is kept (with its commits) unless ?deleteBranch=1. */
export const DELETE = route(async ({ c, params, url }) => {
  const task = c.tasks.get(params.id);
  if (!task.worktree) throw new HttpError(404, "La tarea no tiene worktree");
  if (c.runs.list().some((r) => r.status === "running" && (r.projectPath === task.worktree!.path || r.projectPath.startsWith(task.worktree!.path + "/")))) throw new HttpError(409, "Hay una ejecución activa en este worktree");
  await removeWorktree(task.worktree, { deleteBranch: url.searchParams.get("deleteBranch") === "1" });
  return c.tasks.setWorktree(task.id, null);
});
