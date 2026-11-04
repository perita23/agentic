import { route } from "@/lib/server/api";

/** "Ejecutar ahora": launch once without moving the next scheduled slot. */
export const POST = route(async ({ c, params }) => c.schedules.fire(params.id));
