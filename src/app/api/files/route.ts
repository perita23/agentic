import path from "node:path";
import { route } from "@/lib/server/api";
import { projectFiles, searchFiles } from "@/lib/server/files";
import { HttpError } from "@/lib/server/util";
import { worktreesRoot } from "@/lib/server/worktrees";

/** Autocomplete for "@file" mentions: names only (never contents), inside a known project or task worktree. */
export const GET = route(async ({ c, url }) => {
  const p = url.searchParams.get("project") ?? "";
  const inWorktree = path.resolve(p) === p && p.startsWith(worktreesRoot(c.config.dataDir) + "/"); // normalised: no ".." tricks
  if (!p || (!c.projects.isKnown(p) && !inWorktree)) throw new HttpError(400, "Proyecto desconocido");
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  return { files: searchFiles(await projectFiles(p), q) };
});
