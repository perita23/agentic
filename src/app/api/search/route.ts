import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

export const GET = route(({ c, url }) => {
  const q = url.searchParams.get("q") ?? "";
  if (q.length > 200) throw new HttpError(400, "Consulta demasiado larga");
  return c.sessions.search(q, { project: url.searchParams.get("project") });
});
