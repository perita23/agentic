import { route } from "@/lib/server/api";
import { describeTools } from "@/lib/server/agentic-mcp";

/** Settings of Agentic's MCP server (what Claude may see and do) and its tools. */
const view = (c: Parameters<Parameters<typeof route>[0]>[0]["c"]) => {
  const settings = c.agenticMcp.get();
  return { settings, url: c.agenticMcp.url(), tools: describeTools(settings) };
};
export const GET = route(({ c }) => view(c));
export const PUT = route(async ({ c, body }) => {
  c.agenticMcp.set(await body());
  return view(c);
});
