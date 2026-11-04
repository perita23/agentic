import { route } from "@/lib/server/api";

export const PATCH = route(async ({ c, params, body }) => c.mail.patchItem(params.id, await body()));
