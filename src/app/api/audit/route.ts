import { route } from "@/lib/server/api";
import { readAudit } from "@/lib/server/audit";

export const GET = route(({ c, url }) => ({ entries: readAudit(c.config.dataDir, Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000)) }));
