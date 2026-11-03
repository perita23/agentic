import { route } from "@/lib/server/api";

export const POST = route(async ({ c, params, body }) => Response.json(c.tasks.instantiate(params.id, await body()), { status: 201 }));
