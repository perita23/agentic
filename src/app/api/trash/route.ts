import { route } from "@/lib/server/api";

/** Deleted sessions waiting in the trash (30 days). */
export const GET = route(({ c }) => ({ items: c.trash.list() }));
