import { route } from "@/lib/server/api";

/** Recurring Claude Code runs. */
export const GET = route(({ c }) => ({ schedules: c.schedules.list() }));
export const POST = route(async ({ c, body }) => Response.json(c.schedules.create(await body()), { status: 201 }));
