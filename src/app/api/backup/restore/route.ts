import { route } from "@/lib/server/api";

/** Restore from an uploaded backup or a saved one ({ file }). A safety copy is saved first. */
export const POST = route(
  async ({ c, body }) => {
    const busy = c.runs.list().some((r) => r.status === "running") || c.queue.state().running;
    return c.backups.restore(await body(), busy);
  },
  { maxBody: 50 * 1024 * 1024 },
);
