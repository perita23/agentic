import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { assertNotRateLimited, CHALLENGE_COOKIE, recordFailure, SESSION_COOKIE, SESSION_COOKIE_OPTS } from "@/lib/server/auth";
import { verifyAuthentication } from "@/lib/server/passkeys";
import { parseCookies } from "@/lib/server/security";

export const POST = publicRoute(async ({ c, req, body }) => {
  assertNotRateLimited("passkey-login");
  let sid: string;
  try {
    sid = await verifyAuthentication(c.config.dataDir, req.headers.get("host"), parseCookies(req.headers.get("cookie"))[CHALLENGE_COOKIE], await body(), req.headers.get("user-agent") ?? "");
  } catch (e) {
    recordFailure("passkey-login");
    audit(c.config.dataDir, "login.failed", { method: "passkey" });
    throw e;
  }
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, sid, SESSION_COOKIE_OPTS);
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/api/auth/passkey", maxAge: 0 });
  return res;
});
