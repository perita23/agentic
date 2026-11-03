import { route } from "@/lib/server/api";

/** Send a message: resumes the conversation's Claude session in the background. */
export const POST = route(async ({ c, params, body }) => c.chats.send(params.id, await body()));
