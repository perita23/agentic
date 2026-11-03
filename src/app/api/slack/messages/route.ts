import { z } from "zod";
import { route } from "@/lib/server/api";
import { parse, text } from "@/lib/server/util";

const schema = z.object({
  channel: z.string().max(30),
  text: text(4000).trim().min(1),
  threadTs: z.string().max(30).nullable().optional(),
});

export const POST = route(async ({ c, body }) => {
  const b = parse(schema, await body());
  return c.integrations.slackPost(b.channel, b.text, b.threadTs);
});
