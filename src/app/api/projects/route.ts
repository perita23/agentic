import { route } from "@/lib/server/api";

export const GET = route(({ c }) => ({ projects: c.projects.list() }));
export const POST = route(async ({ c, body }) => Response.json(c.projects.create(await body()), { status: 201 }));
