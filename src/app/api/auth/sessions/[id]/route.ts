import { route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { readAuth, revokeSession } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/util";

/** Revoke one session by the public prefix of its hash. */
export const DELETE = route(({ c, params }) => {
  if (!/^[0-9a-f]{16}$/.test(params.id)) throw new HttpError(400, "id no válido");
  const s = readAuth(c.config.dataDir).sessions.find((x) => x.idHash.startsWith(params.id));
  if (!s) throw new HttpError(404, "Sesión no encontrada");
  revokeSession(c.config.dataDir, s.idHash);
  audit(c.config.dataDir, "session.revoked", { method: s.method });
  return { ok: true };
});
