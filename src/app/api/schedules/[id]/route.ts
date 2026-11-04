import { route } from "@/lib/server/api";

export const PATCH = route(async ({ c, params, body }) => c.schedules.update(params.id, await body()));
export const DELETE = route(({ c, params }) => {
  c.schedules.remove(params.id);
  return { ok: true };
});
