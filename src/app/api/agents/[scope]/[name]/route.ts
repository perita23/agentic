import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

function projectFor(c: Parameters<Parameters<typeof route>[0]>[0]["c"], scope: string, url: URL) {
  if (scope !== "project") return null;
  const p = url.searchParams.get("projectPath");
  if (!p || !c.projects.isKnown(p)) throw new HttpError(400, "Unknown project");
  return p;
}

export const PUT = route(async ({ c, params, url, body }) => {
  const projectPath = projectFor(c, params.scope, url);
  return c.agents.save(params.scope, await body(), projectPath, { create: false, name: params.name });
});

export const DELETE = route(({ c, params, url }) => {
  c.agents.remove(params.scope, params.name, projectFor(c, params.scope, url));
  return { ok: true };
});
