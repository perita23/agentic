import { route } from "@/lib/server/api";

export const GET = route(({ c, params, url }) => {
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  return c.runs.readLog(params.id, offset);
});
