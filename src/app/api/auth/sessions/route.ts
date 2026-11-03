import { currentSession, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { readAuth, revokeOtherSessions } from "@/lib/server/auth";

export const GET = route(({ c, req }) => {
  const me = currentSession(req, c.config.dataDir)?.idHash;
  const now = Date.now();
  return {
    sessions: readAuth(c.config.dataDir)
      .sessions.filter((s) => Date.parse(s.expiresAt) > now)
      .map((s) => ({ id: s.idHash.slice(0, 16), method: s.method, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, userAgent: s.userAgent, current: s.idHash === me }))
      .reverse(),
  };
});

/** Sign out every other session. */
export const DELETE = route(({ c, req }) => {
  const me = currentSession(req, c.config.dataDir);
  revokeOtherSessions(c.config.dataDir, me?.idHash ?? "");
  audit(c.config.dataDir, "sessions.revokedOthers");
  return { ok: true };
});
