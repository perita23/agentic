import { route } from "@/lib/server/api";

export const GET = route(({ c }) => ({ chats: c.chats.list() }));
/** Start a new conversation with its first message. */
export const POST = route(async ({ c, body }) => Response.json(await c.chats.create(await body()), { status: 201 }));
