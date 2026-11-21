import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared workspace packages are plain TypeScript sources (no build step).
  transpilePackages: [
    "@ca-firm/shared-types",
    "@ca-firm/validation",
    "@ca-firm/api-contracts",
  ],
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
