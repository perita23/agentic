import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/server/api";
import { assertNotRateLimited, CHALLENGE_COOKIE } from "@/lib/server/auth";
import { authenticationOptions } from "@/lib/server/passkeys";

export const POST = publicRoute(async ({ c, req }) => {
  assertNotRateLimited("passkey-login");
  const { options, challengeId } = await authenticationOptions(c.config.dataDir, req.headers.get("host"));
  const res = NextResponse.json(options, { headers: { "cache-control": "no-store" } });
  res.cookies.set(CHALLENGE_COOKIE, challengeId, { httpOnly: true, sameSite: "strict", path: "/api/auth/passkey", maxAge: 300 });
  return res;
});
