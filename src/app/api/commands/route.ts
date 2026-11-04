import { route } from "@/lib/server/api";

/** Claude Code custom commands and skills available in a project (plus the user's own). */
export const GET = route(({ c, url }) => ({ commands: c.commands.list(url.searchParams.get("project")) }));
