import { route } from "@/lib/server/api";

export const POST = route(({ c, params }) => c.runs.stop(params.id));
