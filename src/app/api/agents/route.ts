import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

export const GET = route(({ c }) => {
  const projectPaths = c.projects.list().filter((p) => p.exists).map((p) => p.path);
  return { agents: c.agents.list(projectPaths) };
});

export const POST = route(async ({ c, body }) => {
  const b = (await body()) as { scope?: string; projectPath?: string | null };
  const scope = b?.scope ?? "user";
  const projectPath = scope === "project" ? (b.projectPath ?? null) : null;
  if (scope === "project" && (!projectPath || !c.projects.isKnown(projectPath))) throw new HttpError(400, "Unknown project");
  return Response.json(c.agents.save(scope, b, projectPath, { create: true }), { status: 201 });
});
