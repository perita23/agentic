// afterPack hook (runs before any signing):
//  0. Flip the Electron security fuses.
//  1. electron-builder drops node_modules from extraResources, so copy the
//     standalone server's dependencies into Resources/app-server ourselves.
//  2. Without a Developer ID, ad-hoc sign the WHOLE bundle so that
//     `codesign --verify --deep --strict` passes (required on Apple Silicon and
//     by the in-app updater, which refuses bundles with a broken signature).
//  3. Give the app a stable designated requirement (its bundle identifier).
//     An ad-hoc signature's implicit requirement is the exact code hash, which
//     changes with every build, so macOS forgot folder permissions (Documents,
//     Desktop, Downloads… ) after each update and asked again.
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

  // Electron fuses (security checklist), flipped before any signature:
  // no ELECTRON_RUN_AS_NODE / NODE_OPTIONS / --inspect, app code only from the
  // integrity-checked asar, encrypted cookies, no extra file:// privileges.
  const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
  await flipFuses(app, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });

  if (process.env.CSC_LINK) return; // electron-builder signs with the Developer ID next
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", app], { stdio: "inherit" });
  // Re-sign only the outer app (helpers keep their own identifiers and signatures).
  const id = context.packager.appInfo.id;
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Unexpected bundle id: ${id}`);
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", `-r=designated => identifier "${id}"`, app], { stdio: "inherit" });
  const dr = execFileSync("/usr/bin/codesign", ["-d", "-r-", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!dr.includes(`identifier "${id}"`)) throw new Error(`Designated requirement not applied:\n${dr}`);
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
};
