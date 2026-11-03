import { NextResponse } from "next/server";
import { currentSession, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { revokeSession, SESSION_COOKIE } from "@/lib/server/auth";

export const POST = route(({ c, req }) => {
  const me = currentSession(req, c.config.dataDir);
  if (me) revokeSession(c.config.dataDir, me.idHash);
  audit(c.config.dataDir, "logout");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
