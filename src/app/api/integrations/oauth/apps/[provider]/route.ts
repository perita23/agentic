import { route } from "@/lib/server/api";

export const PUT = route(async ({ c, params, body }) => c.oauth.setApp(params.provider, await body()));
export const DELETE = route(({ c, params }) => {
  c.oauth.removeApp(params.provider);
  return { ok: true };
});
