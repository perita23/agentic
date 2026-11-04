import { route } from "@/lib/server/api";
import { switchBranch } from "@/lib/server/branches";
import { HttpError } from "@/lib/server/util";

/** Switch (or create and switch to) a branch of a project. Refused while Claude is working in it. */
export const POST = route(async ({ c, body }) => {
  const b = (await body()) as { project?: unknown };
  if (typeof b?.project !== "string" || !c.projects.isKnown(b.project)) throw new HttpError(400, "Proyecto desconocido");
  if (c.runs.list().some((r) => r.status === "running" && r.projectPath === b.project)) throw new HttpError(409, "Claude está trabajando en este proyecto: espera a que termine para cambiar de rama");
  return switchBranch(b.project, b);
});
