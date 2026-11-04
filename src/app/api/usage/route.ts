import { route } from "@/lib/server/api";

/** Claude plan usage: limits as last reported by Claude Code, plus today's tokens on this device. */
export const GET = route(async ({ c }) => {
  const today = new Date().toISOString().slice(0, 10);
  const a = await c.sessions.analytics(1);
  const d = a.days.find((x) => x.date === today);
  return { limits: c.runs.rateLimits(), tokensToday: d ? d.input + d.output : 0 };
});
