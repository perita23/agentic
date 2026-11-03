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
// Release notes shown in the app after an update ("Novedades").
fs.copyFileSync(path.join(root, "CHANGELOG.md"), path.join(standalone, "CHANGELOG.md"));
// Next does not copy these into the standalone output.
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
// Public OAuth client ids shipped with the build. Only GitHub's device flow
// works with an id alone; client secrets are never bundled (the app is public).
const oauth = {};
if (process.env.AGENTIC_GITHUB_CLIENT_ID) oauth.AGENTIC_GITHUB_CLIENT_ID = process.env.AGENTIC_GITHUB_CLIENT_ID;
fs.writeFileSync(path.join(standalone, "oauth-apps.json"), JSON.stringify(oauth), { mode: 0o644 });

// Public key the app requires on update manifests (repository variable
// AGENTIC_UPDATE_PUBLIC_KEY). Without it the app accepts unsigned updates.
const pubFile = path.join(root, "desktop", "update-key.pem");
const pub = (process.env.AGENTIC_UPDATE_PUBLIC_KEY || "").trim();
if (pub) {
  if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(pub)) throw new Error("AGENTIC_UPDATE_PUBLIC_KEY no es una clave pública PEM");
  fs.writeFileSync(pubFile, pub + "\n");
  console.log("Firma de actualizaciones: obligatoria (clave pública incluida)");
} else if (fs.existsSync(pubFile)) fs.rmSync(pubFile);

// The desktop app always carries the same version as the web app.
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const deskPkgFile = path.join(root, "desktop", "package.json");
const deskPkg = JSON.parse(fs.readFileSync(deskPkgFile, "utf8"));
if (deskPkg.version !== rootPkg.version) {
  deskPkg.version = rootPkg.version;
  fs.writeFileSync(deskPkgFile, JSON.stringify(deskPkg, null, 2) + "\n");
}
console.log(`Servidor standalone listo (v${rootPkg.version}) en`, path.relative(process.cwd(), standalone));
