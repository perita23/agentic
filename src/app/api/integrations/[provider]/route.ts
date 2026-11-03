import { route } from "@/lib/server/api";

export const PUT = route(async ({ c, params, body }) => c.integrations.configure(params.provider, await body()));

export const DELETE = route(({ c, params }) => {
  c.integrations.remove(params.provider);
  return { ok: true };
});
