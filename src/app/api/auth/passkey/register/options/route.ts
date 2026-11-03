import { NextResponse } from "next/server";
import { route } from "@/lib/server/api";
import { CHALLENGE_COOKIE } from "@/lib/server/auth";
import { registrationOptions } from "@/lib/server/passkeys";

export const POST = route(async ({ c, req }) => {
  const { options, challengeId } = await registrationOptions(c.config.dataDir, req.headers.get("host"));
  const res = NextResponse.json(options, { headers: { "cache-control": "no-store" } });
  res.cookies.set(CHALLENGE_COOKIE, challengeId, { httpOnly: true, sameSite: "strict", path: "/api/auth/passkey", maxAge: 300 });
  return res;
});
