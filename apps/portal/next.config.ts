import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const config: NextConfig = {
  reactStrictMode: true,
  // Share the @eins/ui source package across apps without a build step.
  transpilePackages: ["@eins/ui"],
  experimental: {
    // Typed routes + server actions are on by default in 15; leave room for tuning.
  },
  // Security headers — HSTS is added at edge (Cloudflare), these harden everything else.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})(config);
