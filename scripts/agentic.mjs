#!/usr/bin/env node
// Local launcher: ensures the access token exists, prints the login URL and
// starts Next.js bound to loopback only.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] || "start"; // dev | start | url
const expand = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const dataDir = path.resolve(expand(process.env.AGENTIC_HOME || "~/.agentic"));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4317);

if (!["127.0.0.1", "localhost", "::1"].includes(host) && process.env.AGENTIC_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to bind to ${host}: Agentic can execute code on this machine. Set AGENTIC_ALLOW_REMOTE=1 to override.`);
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const tokenFile = path.join(dataDir, "token");
let token = "";
try {
  token = fs.readFileSync(tokenFile, "utf8").trim();
} catch {}
if (!/^[0-9a-f]{64}$/.test(token)) {
  token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
}
if (process.argv.includes("--reset-auth")) {
  // Local recovery: whoever can run this already owns ~/.agentic.
  const authFile = path.join(dataDir, "auth.json");
  try {
    const st = JSON.parse(fs.readFileSync(authFile, "utf8"));
    st.passkeys = [];
    st.sessions = [];
    st.requirePasskey = false;
    fs.writeFileSync(authFile, JSON.stringify(st, null, 2), { mode: 0o600 });
  } catch {}
  fs.appendFileSync(path.join(dataDir, "audit.log"), JSON.stringify({ at: new Date().toISOString(), event: "auth.reset" }) + "\n", { mode: 0o600 });
  console.log("Passkeys y sesiones eliminadas; Touch ID ya no es obligatorio.");
}
if (process.argv.includes("--rotate-token") || process.argv.includes("--reset-auth")) {
  token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  console.log("Token rotated: existing browser sessions are now logged out.");
}

// Passkeys / Touch ID require a domain, so point the browser at localhost.
const urlHost = ["127.0.0.1", "::1", "localhost"].includes(host) ? "localhost" : host;
const url = `http://${urlHost}:${port}/auth?token=${token}`;
const banner = () => {
  console.log("\n  \x1b[1m\x1b[36m◆ Agentic Console\x1b[0m");
  console.log(`  Abre en tu navegador: \x1b[4m${url}\x1b[0m`);
  console.log(`  Datos locales: ${dataDir}\n`);
};

if (mode === "url") {
  banner();
  process.exit(0);
}

if (mode === "start" && !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("No build found. Run `npm run build` first (or use `npm run dev`).");
  process.exit(1);
}

banner();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, mode === "dev" ? "dev" : "start", "-H", host, "-p", String(port)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, AGENTIC_HOME: dataDir, NEXT_TELEMETRY_DISABLED: "1" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
