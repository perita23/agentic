import { z } from "zod";
import { route } from "@/lib/server/api";
import { parse, UUID_RE } from "@/lib/server/util";

export const POST = route(async ({ c, body }) => {
  const { id } = parse(z.object({ id: z.string().regex(UUID_RE) }), await body());
  c.trash.restore(id);
  return { ok: true };
});
