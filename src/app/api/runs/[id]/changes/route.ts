import { route } from "@/lib/server/api";

/** Files this conversation has changed so far (live: includes changes made through the terminal). */
export const GET = route(({ c, params }) => c.runs.diff(params.id, { summary: true }));
