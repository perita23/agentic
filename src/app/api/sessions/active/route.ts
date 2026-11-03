import { route } from "@/lib/server/api";

export const GET = route(({ c }) => ({ processes: c.sessions.active() }));
