import { route } from "@/lib/server/api";
import { islandSnapshot } from "@/lib/server/island";

/** Runs in progress and just finished, for the island at the top of the screen (macOS app). */
export const GET = route(({ c }) => islandSnapshot(c.runs));
