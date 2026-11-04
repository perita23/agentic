import { route } from "@/lib/server/api";

/** Claude Code's MCP servers (secret values are never returned, only their names). */
export const GET = route(({ c }) => ({ servers: c.mcp.list(), configFile: c.mcp.configFile() }));
/** Add one through `claude mcp add`. */
export const POST = route(async ({ c, body }) => c.mcp.add(await body()));
