import type { NextConfig } from "next";

// Static export so any host can serve it (FR-F1, U-21). Record pages read query params, e.g. /receivable?id=12.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // workspace packages ship TypeScript source
  transpilePackages: ["@app/config", "@app/adapters"],
};

export default config;
