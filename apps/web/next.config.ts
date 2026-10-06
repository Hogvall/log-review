import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@log-review/wcl"],
  // Dependencies are hoisted to the monorepo root; without this, Turbopack may pick
  // apps/web as the root and fail to find `next` (it does in the deploy container).
  turbopack: { root: path.join(__dirname, "../..") },
};

export default config;
