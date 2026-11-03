import { route } from "@/lib/server/api";

export const GET = route(({ c }) => ({ tasks: c.tasks.list() }));
export const POST = route(async ({ c, body }) => Response.json(c.tasks.create(await body()), { status: 201 }));
