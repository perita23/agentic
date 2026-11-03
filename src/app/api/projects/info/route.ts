import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

export const GET = route(({ c, url }) => {
  const p = url.searchParams.get("path");
  if (!p) throw new HttpError(400, "path is required");
  return c.projects.info(p);
});
