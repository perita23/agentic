import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/server/config";
import { COOKIE_NAME, isAllowedHost, loadOrCreateToken, safeEqual } from "@/lib/server/security";

/** Exchange `?token=` (printed in the terminal) for an HttpOnly session cookie. */
export function GET(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"))) return new Response("Host not allowed", { status: 421 });
  const token = loadOrCreateToken(getConfig().dataDir);
  const given = request.nextUrl.searchParams.get("token");
  if (!safeEqual(given, token)) {
    return new Response("Token inválido", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  // Redirect relative to the Host we were reached on (already allow-listed).
  const res = NextResponse.redirect(new URL("/", `http://${request.headers.get("host")}`), 303);
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: false, // served over http on loopback
  });
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
