import { route } from "@/lib/server/api";

/** Personal UI preferences (hidden menu items). */
export const GET = route(({ c }) => c.prefs.get());
export const PUT = route(async ({ c, body }) => c.prefs.set(await body()));
