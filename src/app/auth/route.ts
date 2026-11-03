import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/server/audit";
import { assertNotRateLimited, createSession, readAuth, recordFailure, SESSION_COOKIE, SESSION_COOKIE_OPTS } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { isAllowedHost, loadOrCreateToken, safeEqual } from "@/lib/server/security";
import { HttpError } from "@/lib/server/util";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** Exchange the terminal `?token=` for a server-side session (unless Touch ID is required). */
export function GET(request: NextRequest) {
  const host = request.headers.get("host");
  if (!isAllowedHost(host)) return text("Host not allowed", 421);
  const { dataDir } = getConfig();
  const rlKey = `auth:${request.headers.get("x-forwarded-for") ?? "local"}`;
  try {
    assertNotRateLimited(rlKey);
  } catch (e) {
    return text((e as HttpError).message, 429);
  }
  const token = loadOrCreateToken(dataDir);
  if (!safeEqual(request.nextUrl.searchParams.get("token"), token)) {
    recordFailure(rlKey);
    audit(dataDir, "login.failed", { method: "token" });
    return text("Token inválido", 401);
  }
  if (readAuth(dataDir).requirePasskey) {
    audit(dataDir, "login.failed", { method: "token", reason: "passkey-required" });
    return NextResponse.redirect(new URL("/login?reason=passkey", `http://${host}`), 303);
  }
  const sid = createSession(dataDir, "token", request.headers.get("user-agent") ?? "");
  audit(dataDir, "login", { method: "token" });
  // Redirect relative to the Host we were reached on (already allow-listed); the
  // token never stays in the address bar.
  const res = NextResponse.redirect(new URL("/", `http://${host}`), 303);
  res.cookies.set(SESSION_COOKIE, sid, SESSION_COOKIE_OPTS);
  res.cookies.set("agentic_token", "", { path: "/", maxAge: 0 }); // drop the legacy cookie
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
