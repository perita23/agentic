import { z } from "zod";
import { route } from "@/lib/server/api";
import { HttpError, parse, UUID_RE } from "@/lib/server/util";

/** Move sessions to the trash (restorable for 30 days). Running sessions are skipped. */
export const POST = route(async ({ c, body }) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().regex(UUID_RE, "invalid session id")).min(1).max(200) }), await body());
  const removed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      c.trash.remove(id);
      removed.push(id);
    } catch (e) {
      skipped.push({ id, reason: e instanceof HttpError ? e.message : "No se pudo borrar" });
    }
  }
  return { removed, skipped };
});
