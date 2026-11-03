// afterPack hook: without a Developer ID, ad-hoc sign the WHOLE bundle so that
// `codesign --verify --deep --strict` passes (required on Apple Silicon and by
// the in-app updater, which refuses bundles with a broken signature).
"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin" || process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", app], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
};
