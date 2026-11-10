import { route } from "@/lib/server/api";

/** Graphify: is it installed, the setting, and which projects already have a graph. */
export const GET = route(async ({ c, url }) => {
  const detect = await c.graphify.detect(url.searchParams.get("fresh") === "1");
  const projects = c.projects
    .list()
    .filter((p) => (p.registered || p.sessionCount > 0) && p.exists)
    .map((p) => ({ path: p.path, name: p.name }));
  return { settings: c.graphify.get(), ...detect, projects };
});
export const PUT = route(async ({ c, body }) => c.graphify.set(await body()));
