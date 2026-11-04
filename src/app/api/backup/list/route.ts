import { route } from "@/lib/server/api";

export const GET = route(({ c }) => ({ backups: c.backups.list(), dir: c.backups.dir() }));
