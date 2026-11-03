import { route } from "@/lib/server/api";

/** Begin the browser login for Jira / Bitbucket; the redirect comes back to this same host. */
export const POST = route(({ c, params, req }) => c.oauth.start(params.provider, `http://${req.headers.get("host")}`));
