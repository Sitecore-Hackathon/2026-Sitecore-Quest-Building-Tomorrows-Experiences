import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "js", "jsx"],
  serverExternalPackages: ["@anthropic-ai/sdk"],
  images: {
    // Allow Sitecore XM Cloud media library and CDN hostnames
    remotePatterns: [
      { protocol: "https", hostname: "**.sitecorecloud.io" },
      { protocol: "https", hostname: "**.sitecore.com" },
      { protocol: "https", hostname: "**.sitecorecontenthub.cloud" },
    ],
  },
};

export default nextConfig;
