import { route } from "@/lib/server/api";

export const GET = route(({ c, params }) => c.runs.get(params.id));
export const DELETE = route(({ c, params }) => {
  c.runs.remove(params.id);
  return { ok: true };
});
