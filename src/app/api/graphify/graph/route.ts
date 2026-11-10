import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

/** The graph of a project, trimmed to its best-connected nodes, to draw it in the app. */
export const GET = route(({ c, url }) => {
  const p = url.searchParams.get("path");
  if (!p) throw new HttpError(400, "path is required");
  const max = Number(url.searchParams.get("max") ?? 700);
  return c.graphify.view(p, Number.isFinite(max) ? max : 700);
});
