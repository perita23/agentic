import { route } from "@/lib/server/api";

/** The person opened this run (recent use). */
export const POST = route(({ c, params }) => {
  c.runs.touch(params.id);
  return { ok: true };
});
