import { route } from "@/lib/server/api";

/** Artifacts, PRs, issues and documents mentioned in Claude Code sessions. */
export const GET = route(async ({ c }) => c.library.list());
