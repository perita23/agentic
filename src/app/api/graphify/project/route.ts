import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

/** GET: what a project has (graph, report, hook, skill). POST: run one Graphify command in it (update, hook, claude, query). */
export const GET = route(({ c, url }) => {
  const p = url.searchParams.get("path");
  if (!p) throw new HttpError(400, "path is required");
  return c.graphify.status(p);
});
export const POST = route(async ({ c, body }) => c.graphify.run(await body()));
