import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Local, fully dynamic dashboard: every page reads live data from disk.
  poweredByHeader: false,
  // The macOS app bundles a self-contained server (node .next/standalone/server.js).
  ...(process.env.AGENTIC_STANDALONE === "1" ? {
        output: "standalone" as const,
        outputFileTracingRoot: process.cwd(),
        outputFileTracingExcludes: { "*": ["desktop/**", "docs/**", "test/**", "scripts/**", ".github/**", "*.md"] },
      } : {}),
  // Only the version string reaches the client bundle, not the whole package.json.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  reactStrictMode: true,
  // `next dev` must accept requests from the loopback aliases we bind to.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
