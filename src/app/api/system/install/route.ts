import { z } from "zod";
import { route } from "@/lib/server/api";
import { parse } from "@/lib/server/util";

/** Package managers found here and the command that would install each missing tool. */
export const GET = route(({ c }) => c.installer.options());

const schema = z.object({ tool: z.enum(["tmux", "claude"]) }).strict();

/** Start installing a tool with the detected package manager (fixed commands only). */
export const POST = route(async ({ c, body }) => {
  const { tool } = parse(schema, await body());
  return c.installer.start(tool);
});
