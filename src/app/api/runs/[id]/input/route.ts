import { z } from "zod";
import { route } from "@/lib/server/api";
import { parse, text } from "@/lib/server/util";

const schema = z.object({ text: text(10_000).min(1) });

export const POST = route(async ({ c, params, body }) => {
  const { text: input } = parse(schema, await body());
  await c.runs.sendKeys(params.id, input);
  return { ok: true };
});
