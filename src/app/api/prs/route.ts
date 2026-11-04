import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

export const GET = route(({ c }) => c.pulls.inbox());

/** Create a pull request from a branch of a known project (pushes the branch first). */
export const POST = route(async ({ c, body }) => {
  const b = (await body()) as { projectPath?: unknown };
  if (typeof b?.projectPath !== "string" || !c.projects.isKnown(b.projectPath)) throw new HttpError(400, "Elige un proyecto de Agentic");
  return Response.json(await c.pulls.createFromBranch(b.projectPath, b), { status: 201 });
});
