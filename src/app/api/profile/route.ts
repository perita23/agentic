import { route } from "@/lib/server/api";

/** Name, avatar and figures of the person using this app. */
export const GET = route(({ c }) => {
  const runs = c.runs.list();
  const first = runs.reduce<string | null>((a, r) => (!a || r.startedAt < a ? r.startedAt : a), null);
  return {
    ...c.profile.get(),
    stats: {
      runs: runs.length,
      completed: runs.filter((r) => r.status === "completed").length,
      tokens: runs.reduce((a, r) => a + (r.tokens ?? 0), 0),
      firstRunAt: first,
    },
  };
});
export const PUT = route(async ({ c, body }) => c.profile.set(await body()));
