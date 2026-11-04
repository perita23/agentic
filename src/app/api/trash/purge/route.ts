import { z } from "zod";
import { route } from "@/lib/server/api";
import { parse, UUID_RE } from "@/lib/server/util";

/** Erase for good: one session ({ id }) or the whole trash ({ all: true }). */
export const POST = route(async ({ c, body }) => {
  const { id, all } = parse(z.object({ id: z.string().regex(UUID_RE).optional(), all: z.boolean().optional() }), await body());
  if (all) c.trash.purgeAll();
  else if (id) c.trash.purge(id);
  return { ok: true };
});
