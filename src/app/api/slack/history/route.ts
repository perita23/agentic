import { route } from "@/lib/server/api";

export const GET = route(({ c, url }) => {
  const cursor = url.searchParams.get("cursor");
  return c.integrations.slackHistory(url.searchParams.get("channel") ?? "", cursor && /^[A-Za-z0-9=_-]{1,200}$/.test(cursor) ? cursor : undefined);
});
