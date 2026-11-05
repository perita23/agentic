import { route } from "@/lib/server/api";

/** Obsidian: where the vault is and what Claude may write in it. */
export const GET = route(({ c }) => c.obsidian.status());
export const PUT = route(async ({ c, body }) => {
  c.obsidian.set(await body());
  return c.obsidian.status();
});
