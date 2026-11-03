import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

/** comment | transition | import */
export const POST = route(async ({ c, params, body }) => {
  const b = await body();
  switch (params.action) {
    case "comment":
      return c.jira.comment(params.key, b);
    case "transition":
      return c.jira.transition(params.key, b);
    case "import":
      return c.jira.importIssue(params.key, b);
    default:
      throw new HttpError(404, "Acción desconocida");
  }
});
