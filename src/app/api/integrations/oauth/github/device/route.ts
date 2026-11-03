import { route } from "@/lib/server/api";

/** Start GitHub's device flow: returns the code to type on github.com. */
export const POST = route(({ c }) => c.oauth.startGithubDevice());
