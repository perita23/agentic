"use strict";

const { execFileSync } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");

/**
 * Apps launched from Finder/Dock get a minimal PATH (/usr/bin:/bin:...), so
 * `claude`, `git` from Homebrew, `tmux`… would not be found. Ask the user's
 * login shell for its PATH once at startup (no command from user data is run).
 */
function loginShellPath(fallback = process.env.PATH || "") {
  if (process.platform === "win32") return fallback;
  const shell = /^\/[\w/.-]+$/.test(process.env.SHELL || "") ? process.env.SHELL : "/bin/zsh";
  try {
    const out = execFileSync(shell, ["-ilc", 'printf "__AGENTIC_PATH__%s__AGENTIC_PATH__" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = /__AGENTIC_PATH__(.*?)__AGENTIC_PATH__/s.exec(out);
    if (m && m[1].trim()) return mergePaths(m[1].trim(), fallback);
  } catch {}
  return mergePaths(`${os.homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin`, fallback);
}

function mergePaths(...lists) {
  const seen = new Set();
  return lists
    .flatMap((l) => l.split(":"))
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(":");
}

/** Preferred port if free on loopback, otherwise an ephemeral one. */
function pickPort(preferred = 4317) {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(null));
      srv.listen(port, "127.0.0.1", () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
    });
  return tryPort(preferred).then((p) => p ?? tryPort(0));
}

/** Resolve once something accepts connections on host:port. */
function waitForPort(port, host = "127.0.0.1", timeoutMs = 30_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, host);
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("El servidor de Agentic no arrancó a tiempo"));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

module.exports = { loginShellPath, mergePaths, pickPort, waitForPort };
