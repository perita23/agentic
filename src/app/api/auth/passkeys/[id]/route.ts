import { route } from "@/lib/server/api";
import { removePasskey } from "@/lib/server/passkeys";
import { HttpError } from "@/lib/server/util";

export const DELETE = route(({ c, params }) => {
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(params.id)) throw new HttpError(400, "id no válido");
  removePasskey(c.config.dataDir, params.id);
  return { ok: true };
});
