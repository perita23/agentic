import { route } from "@/lib/server/api";

export const POST = route(async ({ c, body }) => c.jira.search(await body()));
