import { route } from "@/lib/server/api";

export const GET = route(async ({ c }) => ({ channels: await c.integrations.slackChannels() }));
