import { route } from "@/lib/server/api";

export const PUT = route(async ({ c, body }) => c.mail.updateSettings(await body()));
