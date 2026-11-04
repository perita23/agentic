import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

/** Possible reviewers for a PR from this project's repository. */
export const GET = route(async ({ c, url }) => {
  const p = url.searchParams.get("project") ?? "";
  if (!c.projects.isKnown(p)) throw new HttpError(400, "Proyecto desconocido");
  return { reviewers: await c.pulls.reviewerCandidates(p) };
});
