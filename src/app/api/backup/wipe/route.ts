import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { route } from "@/lib/server/api";
import { HttpError, parse } from "@/lib/server/util";
import { removeWorktree } from "@/lib/server/worktrees";

/** Delete all of Agentic's data on this device (login is kept). */
export const POST = route(async ({ c, body }) => {
  const { includeBackups } = parse(z.object({ confirm: z.literal("BORRAR", { message: "Escribe BORRAR para confirmar" }), includeBackups: z.boolean().default(false) }), await body());
  if (c.runs.list().some((r) => r.status === "running") || c.queue.state().running) throw new HttpError(409, "Hay ejecuciones o una cola en marcha: detenlas antes");
  // Unregister task worktrees from their repos (their branches stay).
  for (const t of c.tasks.list()) if (t.worktree) await removeWorktree(t.worktree).catch(() => {});
  c.backups.wipe({ includeBackups });
  audit(c.config.dataDir, "data-wipe", { includeBackups });
  return { ok: true };
});
