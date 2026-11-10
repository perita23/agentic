import { z } from "zod";
import { route } from "@/lib/server/api";
import { parse } from "@/lib/server/util";

export const GET = route(({ c, params }) => c.runs.get(params.id));
/** Rename a run (an empty title shows the prompt again). */
export const PATCH = route(async ({ c, params, body }) => c.runs.rename(params.id, parse(z.object({ title: z.string().max(400) }), await body()).title));
export const DELETE = route(({ c, params }) => {
  c.runs.remove(params.id);
  return { ok: true };
});
