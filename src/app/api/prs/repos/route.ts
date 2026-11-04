import { route } from "@/lib/server/api";

/** Projects whose `origin` is on a connected GitHub/Bitbucket account (where a PR can be opened). */
export const GET = route(async ({ c }) => ({ repos: await c.pulls.repos() }));
