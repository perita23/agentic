import { route } from "@/lib/server/api";

/** The message's text, fetched from the mail server when you open it. */
export const GET = route(async ({ c, params }) => c.mail.body(params.id));
