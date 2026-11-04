import { route } from "@/lib/server/api";

/** Spending limits and current usage. */
export const GET = route(({ c }) => c.budgets.status());
export const PUT = route(async ({ c, body }) => {
  c.budgets.setConfig(await body());
  await c.budgets.check();
  return c.budgets.status();
});
