// electron-builder configuration for the macOS app.
// Without a Developer ID certificate the app is ad-hoc signed (required on
// Apple Silicon); with CSC_LINK/CSC_KEY_PASSWORD it is properly signed with the
// hardened runtime, and notarized when APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD /
// APPLE_TEAM_ID are present.
"use strict";

const signed = !!process.env.CSC_LINK;
const notarize = signed && !!process.env.APPLE_ID && !!process.env.APPLE_APP_SPECIFIC_PASSWORD && !!process.env.APPLE_TEAM_ID;

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "dev.agentic.console",
  productName: "Agentic",
  copyright: "Copyright © 2026 Hugo Gonzalez Bedmar · PolyForm Noncommercial 1.0.0",
  directories: { output: "dist", buildResources: "build" },
  files: ["main.cjs", "preload.cjs", "server-entry.cjs", "lock.html", "lock.js", "lock-preload.cjs", "island-preload.cjs", "update-key.pem", "lib/**/*", "package.json"],
  // The Next.js standalone server (incl. its .next folder) runs with Electron's Node.
  extraResources: [
    { from: "../.next/standalone", to: "app-server", filter: ["**/*", ".next/**/*", "**/.next/**/*"] },
    // The dictation helper (built by scripts/build-voice.sh); builds without it simply have no dictation.
    ...(require("node:fs").existsSync(require("node:path").join(__dirname, "build", "agentic-listen")) ? [{ from: "build/agentic-listen", to: "agentic-listen" }] : []),
  ],
  asar: true,
  afterPack: "build/after-pack.cjs",
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.png",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    minimumSystemVersion: "13.0",
    // Unsigned builds skip electron-builder's signing; build/adhoc-sign.cjs seals the bundle instead.
    identity: signed ? undefined : null,
    hardenedRuntime: signed,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize,
    extendInfo: {
      LSApplicationCategoryType: "public.app-category.developer-tools",
      NSHumanReadableCopyright: "Agentic Console — PolyForm Noncommercial 1.0.0",
      // Shown by macOS when Agentic first reads a project in these folders.
      NSMicrophoneUsageDescription: "Agentic escucha tu voz para escribir lo que dictas.",
      NSSpeechRecognitionUsageDescription: "Agentic convierte tu voz en texto cuando dictas.",
      NSDocumentsFolderUsageDescription: "Agentic lee tus proyectos y los agentes de Claude Code (.claude) que están en Documentos.",
      NSDesktopFolderUsageDescription: "Agentic lee tus proyectos y los agentes de Claude Code (.claude) que están en el Escritorio.",
      NSDownloadsFolderUsageDescription: "Agentic lee tus proyectos y los agentes de Claude Code (.claude) que están en Descargas.",
      NSRemovableVolumesUsageDescription: "Agentic lee tus proyectos guardados en discos externos.",
      NSNetworkVolumesUsageDescription: "Agentic lee tus proyectos guardados en volúmenes de red.",
    },
  },
  dmg: { title: "Agentic ${version}", backgroundColor: "#0a0a0a" },
  // Generates dist/latest-mac.yml (versions + SHA-512) consumed by lib/updater.cjs.
  // Uploading is done by the release workflow, never by electron-builder.
  publish: { provider: "github", owner: "perita23", repo: "agentic", releaseType: "release" },
};
