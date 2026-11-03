import { z } from "zod";
import { currentSession, route } from "@/lib/server/api";
import { setRequirePasskey } from "@/lib/server/passkeys";
import { parse } from "@/lib/server/util";

const schema = z.object({ requirePasskey: z.boolean() }).strict();

export const PATCH = route(async ({ c, req, body }) => {
  const { requirePasskey } = parse(schema, await body());
  setRequirePasskey(c.config.dataDir, requirePasskey, currentSession(req, c.config.dataDir)?.session ?? null);
  return { ok: true, requirePasskey };
});
