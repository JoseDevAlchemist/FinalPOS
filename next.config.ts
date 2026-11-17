import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MPESA_TEST_BASE_URL ? ".next-mpesa-test" : ".next",
  experimental: {
    agentFeedback: true,
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  logging: { incomingRequests: { ignore: [/^\/api\/(?:pos\/)?mpesa\/callback/, /^\/api\/mpesa\/c2b(?:\/|$)/, /^\/documents\//] } },
  async headers() {
    return [{ source: "/documents/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "private, no-store" },
    ] }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  webpack: (config) => {
    // The display package exports only a browser entry, including for SSR bundling.
    config.resolve = {
      ...config.resolve,
      conditionNames: [...(config.resolve.conditionNames ?? []), "browser"],
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      "@point-of-sale/webserial-customer-display": "./node_modules/@point-of-sale/webserial-customer-display/dist/webserial-customer-display.esm.js",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
