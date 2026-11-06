import { route } from "@/lib/server/api";

/** The command that adds Agentic's tools to another Claude Code (with the token inside: it only goes to someone who is signed in). */
export const POST = route(({ c }) => ({
  command: `claude mcp add --transport http agentic ${c.agenticMcp.url()} --header "Authorization: Bearer ${c.agenticMcp.token()}"`,
}));
