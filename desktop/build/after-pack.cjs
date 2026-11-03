// afterPack hook (runs before any signing):
//  1. electron-builder drops node_modules from extraResources, so copy the
//     standalone server's dependencies into Resources/app-server ourselves.
//  2. Without a Developer ID, ad-hoc sign the WHOLE bundle so that
//     `codesign --verify --deep --strict` passes (required on Apple Silicon and
//     by the in-app updater, which refuses bundles with a broken signature).
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  const from = path.resolve(__dirname, "..", "..", ".next", "standalone", "node_modules");
  const to = path.join(app, "Contents", "Resources", "app-server", "node_modules");
  if (!fs.existsSync(from)) throw new Error(`Missing ${from}: run npm run desktop:prepare first`);
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  if (!fs.existsSync(path.join(to, "next", "package.json"))) throw new Error("Bundled server is missing the 'next' package");

  if (process.env.CSC_LINK) return; // electron-builder signs with the Developer ID next
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", app], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
};
