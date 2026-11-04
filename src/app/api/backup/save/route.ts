import { route } from "@/lib/server/api";

/** Save a copy now (kept until deleted by hand; automatic ones rotate). */
export const POST = route(({ c }) => ({ name: c.backups.save("manual") }));
