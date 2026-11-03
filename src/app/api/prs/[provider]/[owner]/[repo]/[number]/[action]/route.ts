import { route } from "@/lib/server/api";

/** comment | review | merge | close */
export const POST = route(async ({ c, params, body }) =>
  c.pulls.action(params.provider, params.owner, params.repo, Number(params.number), params.action, await body()),
);
