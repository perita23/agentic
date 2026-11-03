import { route } from "@/lib/server/api";

export const GET = route(async ({ c }) => {
  await c.runs.refreshTmux();
  return { runs: c.runs.list() };
});

export const POST = route(async ({ c, body }) => {
  const b = (await body()) as Record<string, unknown>;
  // Fail before spawning anything if the linked task does not exist.
  if (typeof b?.taskId === "string") c.tasks.get(b.taskId);
  const run = await c.runs.start(b);
  if (run.taskId) c.tasks.attachRun(run.taskId, run.id);
  return Response.json(run, { status: 201 });
});
