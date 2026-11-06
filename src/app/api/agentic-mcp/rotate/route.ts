import { route } from "@/lib/server/api";

/** A new token: what was configured with the old one stops working. */
export const POST = route(({ c }) => {
  c.agenticMcp.rotate();
  return { ok: true };
});
