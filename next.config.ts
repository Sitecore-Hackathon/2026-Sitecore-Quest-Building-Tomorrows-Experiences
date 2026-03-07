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
  async headers() {
    return [
      {
        // Allow Sitecore to embed this app in an iframe
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
        ],
      },
    ];
  },
};

export default nextConfig;
