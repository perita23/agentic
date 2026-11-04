import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

export const GET = route(({ c, url }) => {
  const p = url.searchParams.get("project") ?? "";
  if (!c.projects.isKnown(p)) throw new HttpError(400, "Proyecto desconocido");
  return c.pulls.branches(p);
});
