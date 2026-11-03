import { route } from "@/lib/server/api";

export const GET = route(({ c, url }) => {
  const days = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("days")) || 30), 1), 365);
  const project = url.searchParams.get("project");
  return c.sessions.analytics(days, project || null);
});
