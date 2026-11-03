import { route } from "@/lib/server/api";

export const GET = route(({ c, url }) => c.integrations.slackReplies(url.searchParams.get("channel") ?? "", url.searchParams.get("ts") ?? ""));
