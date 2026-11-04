import { route } from "@/lib/server/api";
import { removeWorktree } from "@/lib/server/worktrees";

export const GET = route(({ c, params }) => c.tasks.get(params.id));
export const PATCH = route(async ({ c, params, body }) => c.tasks.update(params.id, await body()));
export const DELETE = route(async ({ c, params }) => {
  const task = c.tasks.get(params.id);
  // The folder goes with the task; its branch (and any commits) is kept in the repo.
  if (task.worktree) await removeWorktree(task.worktree).catch(() => {});
  c.tasks.remove(params.id);
  return { ok: true };
});
