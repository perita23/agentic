// Assemble the self-contained server the macOS app ships:
//   AGENTIC_STANDALONE=1 next build  ->  .next/standalone (+ static assets and public/)
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("Falta .next/standalone. Ejecuta primero: AGENTIC_STANDALONE=1 npm run build");
  process.exit(1);
}
// Next does not copy these into the standalone output.
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
// The desktop app always carries the same version as the web app.
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const deskPkgFile = path.join(root, "desktop", "package.json");
const deskPkg = JSON.parse(fs.readFileSync(deskPkgFile, "utf8"));
if (deskPkg.version !== rootPkg.version) {
  deskPkg.version = rootPkg.version;
  fs.writeFileSync(deskPkgFile, JSON.stringify(deskPkg, null, 2) + "\n");
}
console.log(`Servidor standalone listo (v${rootPkg.version}) en`, path.relative(process.cwd(), standalone));
