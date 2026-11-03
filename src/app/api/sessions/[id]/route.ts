import { route } from "@/lib/server/api";
import { HttpError, UUID_RE } from "@/lib/server/util";

export const GET = route(async ({ c, params }) => {
  if (!UUID_RE.test(params.id)) throw new HttpError(400, "invalid session id");
  const t = await c.sessions.transcript(params.id);
  if (!t) throw new HttpError(404, "Session not found");
  return t;
});
