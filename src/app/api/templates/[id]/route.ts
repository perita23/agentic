import { route } from "@/lib/server/api";

export const PUT = route(async ({ c, params, body }) => c.tasks.updateTemplate(params.id, await body()));
export const DELETE = route(({ c, params }) => {
  c.tasks.removeTemplate(params.id);
  return { ok: true };
});
