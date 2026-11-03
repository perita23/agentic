import { route } from "@/lib/server/api";
import { markSeen, whatsNew } from "@/lib/server/changelog";
import pkg from "../../../../package.json";

/** Release notes to show after an update (and whether to show them). */
export const GET = route(({ c }) => whatsNew(c.store, pkg.version));

/** "Entendido": don't show these notes again. */
export const POST = route(({ c }) => {
  markSeen(c.store, pkg.version);
  return { ok: true };
});
