import { route } from "@/lib/server/api";

export const POST = route(async ({ c, body }) => {
  const account = await c.mail.addAccount(await body());
  void c.mail.sync(); // first fetch in the background
  return Response.json(account, { status: 201 });
});
