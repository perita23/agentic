import { route } from "@/lib/server/api";

export const GET = route(({ c }) => ({ templates: c.tasks.templates() }));
export const POST = route(async ({ c, body }) => Response.json(c.tasks.createTemplate(await body()), { status: 201 }));
