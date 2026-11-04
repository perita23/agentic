import fs from "node:fs";
import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";
import { createWorktree } from "@/lib/server/worktrees";

/** Launch Claude Code for a task, using its prompt (or title + description). */
export const POST = route(async ({ c, params, body }) => {
  const task = c.tasks.get(params.id);
  const { worktree: isolate, ...opts } = ((await body()) ?? {}) as Record<string, unknown>;
  let projectPath = (opts.projectPath as string) || task.projectPath;
  if (!projectPath) throw new HttpError(400, "La tarea no tiene proyecto asociado");
  if (isolate === true) {
    // Reuse the task's worktree while it still exists, otherwise create one (own branch).
    let wt = task.worktree && fs.existsSync(task.worktree.path) && task.worktree.projectPath === projectPath ? task.worktree : null;
    if (!wt) {
      if (!c.projects.isKnown(projectPath)) throw new HttpError(400, "Proyecto desconocido");
      wt = await createWorktree(c.config.dataDir, projectPath, task.id, task.title);
      c.tasks.setWorktree(task.id, wt);
    }
    projectPath = wt.cwd ?? wt.path;
  }
  const checklist = task.checklist.length ? `\n\nChecklist:\n${task.checklist.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n")}` : "";
  const given = typeof opts.prompt === "string" ? opts.prompt.trim() : "";
  const prompt = given || task.prompt.trim() || `${task.title}\n\n${task.description}${checklist}`.trim();
  const run = await c.runs.start({ ...opts, projectPath, prompt, taskId: task.id });
  c.tasks.attachRun(task.id, run.id);
  return Response.json(run, { status: 201 });
});
