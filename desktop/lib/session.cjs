// Opens a server-side Agentic session for the desktop app after the user has
// been verified with Touch ID. Writes the same format as src/lib/server/auth.ts
// (only the SHA-256 of the session id is stored). Kept dependency-free so the
// main process does not need to load the Next.js server code.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TTL = 30 * 24 * 3600_000;

function readAuth(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "auth.json"), "utf8"));
  } catch {
    return { userId: crypto.randomBytes(16).toString("base64url"), requirePasskey: false, sessions: [], passkeys: [] };
  }
}

/**
 * @param {string} dataDir  ~/.agentic
 * @param {{ touchId: boolean }} verified  whether Touch ID was verified natively
 * @returns {string} raw session id for the cookie
 */
function createDesktopSession(dataDir, verified) {
  const st = readAuth(dataDir);
  if (st.requirePasskey && !verified.touchId) {
    const err = new Error("Touch ID es obligatorio en Agentic y este Mac no ha podido verificarlo.");
    err.code = "TOUCH_ID_REQUIRED";
    throw err;
  }
  const raw = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  st.sessions = (st.sessions || []).filter((s) => Date.parse(s.expiresAt) > now);
  st.sessions.push({
    idHash: crypto.createHash("sha256").update(raw).digest("hex"),
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL).toISOString(),
    method: verified.touchId ? "desktop" : "token",
    userAgent: "Agentic Desktop",
  });
  st.sessions = st.sessions.slice(-50);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const f = path.join(dataDir, "auth.json");
  const tmp = `${f}.${process.pid}.${now}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  fs.appendFileSync(
    path.join(dataDir, "audit.log"),
    JSON.stringify({ at: new Date(now).toISOString(), event: "login", detail: { method: verified.touchId ? "desktop-touchid" : "desktop" } }) + "\n",
    { mode: 0o600 },
  );
  return raw;
}

module.exports = { createDesktopSession };
