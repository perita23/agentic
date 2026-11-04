import { route } from "@/lib/server/api";

/** Claude Code permission rules of one settings file (user, project or local). */
export const GET = route(({ c, url }) => c.permissions.get({ scope: url.searchParams.get("scope") ?? "user", projectPath: url.searchParams.get("project") }));
/** Replace the `permissions` block; every other setting in the file is kept. */
export const PUT = route(async ({ c, body }) => c.permissions.save(await body()));
