"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The lock window page as a self-contained data: URL.
 *
 * With the GrantFileProtocolExtraPrivileges fuse off, Chromium can no longer
 * read files inside app.asar through file:// (ERR_FILE_NOT_FOUND → blank
 * window). The files are read with fs (asar-aware) instead and the script is
 * inlined under a per-load CSP nonce, so nothing but our own code can run.
 */
function buildLockPage(dir) {
  const nonce = crypto.randomBytes(16).toString("base64");
  const js = fs.readFileSync(path.join(dir, "lock.js"), "utf8");
  if (/<\/script/i.test(js)) throw new Error("lock.js must not contain </script>");
  let html = fs.readFileSync(path.join(dir, "lock.html"), "utf8");
  html = html
    .replace("script-src 'self'", `script-src 'nonce-${nonce}'`)
    .replace(/<script src="lock\.js" defer><\/script>\s*/, "")
    .replace("</body>", `<script nonce="${nonce}">${js}</script>\n  </body>`);
  if (!html.includes(`nonce="${nonce}"`) || !html.includes(`'nonce-${nonce}'`) || html.includes('src="lock.js"')) throw new Error("lock page template changed: inlining failed");
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}

module.exports = { buildLockPage };
