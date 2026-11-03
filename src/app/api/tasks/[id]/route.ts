import { route } from "@/lib/server/api";

export const GET = route(({ c, params }) => c.tasks.get(params.id));
export const PATCH = route(async ({ c, params, body }) => c.tasks.update(params.id, await body()));
export const DELETE = route(({ c, params }) => {
  c.tasks.remove(params.id);
  return { ok: true };
});
