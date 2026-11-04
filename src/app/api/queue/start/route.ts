import { route } from "@/lib/server/api";

export const POST = route(async ({ c, body }) => {
  // Refuse up front so the user gets the reason instead of an instantly stopped queue.
  await c.budgets.assertAutomationAllowed();
  return c.queue.start(await body());
});
