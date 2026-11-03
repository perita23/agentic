import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local, fully dynamic dashboard: every page reads live data from disk.
  poweredByHeader: false,
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
