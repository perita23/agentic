import { route } from "@/lib/server/api";
import { branchInfo } from "@/lib/server/branches";

export const GET = route(({ c, url }) => {
  const p = url.searchParams.get("project") ?? "";
  // Task worktrees (and anything else that is not a registered project) simply have no switcher.
  if (!c.projects.isKnown(p)) return { isRepo: false, current: null, detached: false, local: [], remote: [], dirty: 0 };
  return branchInfo(p);
});
