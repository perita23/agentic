import { route } from "@/lib/server/api";

export const GET = route(({ c, params }) => c.chats.get(params.id));
export const PATCH = route(async ({ c, params, body }) => c.chats.update(params.id, await body()));
export const DELETE = route(({ c, params }) => {
  c.chats.remove(params.id);
  return { ok: true };
});
