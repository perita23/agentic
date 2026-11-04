import { z } from "zod";
import { route } from "@/lib/server/api";
import { HttpError, parse, text } from "@/lib/server/util";
import { baseBranch, commitAll, pushBranch, worktreeStatus } from "@/lib/server/worktrees";

const schema = z.object({
  title: text(250).trim().min(1),
  body: text(60_000).default(""),
  draft: z.boolean().default(false),
  commitMessage: text(2000).trim().optional(),
});

/** Commit pending changes, push the task branch and open a pull request. */
export const POST = route(async ({ c, params, body }) => {
  const task = c.tasks.get(params.id);
  const wt = task.worktree;
  if (!wt) throw new HttpError(404, "La tarea no tiene worktree");
  if (task.pullRequest) throw new HttpError(409, `Ya hay una PR para esta tarea: ${task.pullRequest.url}`);
  if (c.runs.list().some((r) => r.status === "running" && (r.projectPath === wt.path || r.projectPath.startsWith(wt.path + "/")))) throw new HttpError(409, "Claude sigue trabajando en este worktree");
  const input = parse(schema, await body());
  // Fail early (before committing) when no GitHub/Bitbucket account fits this repo.
  const repo = await c.pulls.repoFor(wt.projectPath);
  try {
    await commitAll(wt, input.commitMessage || input.title);
  } catch (e) {
    throw new HttpError(400, `No se pudo hacer commit: ${(e as Error).message}`);
  }
  const st = await worktreeStatus(wt);
  if (!st.ahead && wt.base) throw new HttpError(400, "La rama no tiene cambios respecto a " + wt.base);
  await pushBranch(wt, () => c.integrations.gitAuthHeader(repo.provider));
  const pr = await c.pulls.create(wt.projectPath, { head: wt.branch, base: await baseBranch(wt), title: input.title, body: input.body, draft: input.draft });
  return c.tasks.setPullRequest(task.id, { ...pr, createdAt: new Date().toISOString() });
});
