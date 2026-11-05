import { route } from "@/lib/server/api";

/** Messages waiting for this conversation (written while Claude was working). */
export const GET = route(({ c, params }) => ({ queue: c.replies.list(params.id) }));

export const POST = route(async ({ c, params, body }) => {
  const r = await c.replies.add(params.id, await body());
  return Response.json(r, { status: r.started ? 201 : 202 });
});

/** Send the first queued message now (used when the queue paused after a stop or a failure). */
export const PUT = route(({ c, params }) => c.replies.sendNext(params.id));
