import { route } from "@/lib/server/api";
import { CHALLENGE_COOKIE } from "@/lib/server/auth";
import { verifyRegistration } from "@/lib/server/passkeys";
import { parseCookies } from "@/lib/server/security";

export const POST = route(async ({ c, req, body }) =>
  verifyRegistration(c.config.dataDir, req.headers.get("host"), parseCookies(req.headers.get("cookie"))[CHALLENGE_COOKIE], await body()),
);
