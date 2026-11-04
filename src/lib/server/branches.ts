import { z } from "zod";
import { git, gitStrict } from "./git";
import { HttpError, parse } from "./util";

/** Branch of a project folder and moving between branches (never destructive: no force, no discarding changes). */
export const branchName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][\w./-]*$/, "Nombre de rama no válido")
  .refine((b) => !b.includes("..") && !b.endsWith("/") && !b.endsWith(".lock") && !b.includes("//"), "Nombre de rama no válido");

const switchSchema = z.object({ branch: branchName, create: z.boolean().default(false) });

export interface BranchInfo {
  isRepo: boolean;
  /** Current branch, or the short hash when detached. */
  current: string | null;
  detached: boolean;
  local: string[];
  /** Remote branches (origin) that have no local copy yet. */
  remote: string[];
  /** Files with uncommitted changes (they travel with you when switching; git refuses if they would be lost). */
  dirty: number;
}

export async function branchInfo(cwd: string): Promise<BranchInfo> {
  const inside = (await git(cwd, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
  if (!inside) return { isRepo: false, current: null, detached: false, local: [], remote: [], dirty: 0 };
  const head = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() || "";
  const detached = head === "HEAD";
  const current = detached ? ((await git(cwd, ["rev-parse", "--short", "HEAD"]))?.trim() ?? null) : head || null;
  const names = async (ref: string) => (await git(cwd, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", ref]))?.split("\n").map((x) => x.trim()).filter(Boolean) ?? [];
  const local = (await names("refs/heads")).slice(0, 200);
  const have = new Set(local);
  const remote = (await names("refs/remotes/origin"))
    .map((r) => r.replace(/^origin\//, ""))
    .filter((r) => r && r !== "HEAD" && !have.has(r))
    .slice(0, 200);
  const dirty = ((await git(cwd, ["status", "--porcelain"])) ?? "").split("\n").filter(Boolean).length;
  return { isRepo: true, current, detached, local, remote, dirty };
}

export async function switchBranch(cwd: string, body: unknown): Promise<BranchInfo> {
  const { branch, create } = parse(switchSchema, body);
  const info = await branchInfo(cwd);
  if (!info.isRepo) throw new HttpError(400, "Este proyecto no es un repositorio git");
  if (!create && info.current === branch && !info.detached) return info;
  if (create && (info.local.includes(branch) || info.remote.includes(branch))) throw new HttpError(409, `Ya existe la rama «${branch}»`);
  if (!create && !info.local.includes(branch) && !info.remote.includes(branch)) throw new HttpError(404, `No existe la rama «${branch}»`);
  try {
    // `git switch` refuses (and changes nothing) if uncommitted changes would be overwritten.
    await gitStrict(cwd, create ? ["switch", "-c", branch] : ["switch", branch]);
  } catch (e) {
    const msg = (e as Error).message;
    throw new HttpError(409, /overwritten|local changes|commit your changes or stash/i.test(msg) ? `Tienes cambios sin commit que se perderían al cambiar a «${branch}». Haz commit o guárdalos antes.` : `No se pudo cambiar de rama: ${msg}`);
  }
  return branchInfo(cwd);
}
