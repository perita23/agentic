import { route } from "@/lib/server/api";

export const DELETE = route(({ c, params }) => {
  c.mail.removeAccount(params.id);
  return { ok: true };
});
