import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@healthcare/backend", "@healthcare/contracts", "@healthcare/database", "@healthcare/domain"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
