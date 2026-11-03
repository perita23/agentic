import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

/** Launch Claude Code for a task, using its prompt (or title + description). */
export const POST = route(async ({ c, params, body }) => {
  const task = c.tasks.get(params.id);
  const opts = ((await body()) ?? {}) as Record<string, unknown>;
  const projectPath = (opts.projectPath as string) || task.projectPath;
  if (!projectPath) throw new HttpError(400, "La tarea no tiene proyecto asociado");
  const checklist = task.checklist.length ? `\n\nChecklist:\n${task.checklist.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n")}` : "";
  const given = typeof opts.prompt === "string" ? opts.prompt.trim() : "";
  const prompt = given || task.prompt.trim() || `${task.title}\n\n${task.description}${checklist}`.trim();
  const run = await c.runs.start({ ...opts, projectPath, prompt, taskId: task.id });
  c.tasks.attachRun(task.id, run.id);
  return Response.json(run, { status: 201 });
});
