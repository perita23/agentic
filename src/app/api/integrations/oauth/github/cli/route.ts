import { route } from "@/lib/server/api";

/** Reuse the GitHub CLI's login (`gh auth token`). */
export const POST = route(({ c }) => c.oauth.connectGithubCli());
