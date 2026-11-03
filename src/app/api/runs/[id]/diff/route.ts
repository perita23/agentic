import { route } from "@/lib/server/api";

export const GET = route(({ c, params }) => c.runs.diff(params.id));
