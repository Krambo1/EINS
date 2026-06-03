import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const config: NextConfig = {
  reactStrictMode: true,
  // Per-instance build dir so parallel `next dev` servers (scripts/dev.js,
  // one per --port) don't share/clobber a single .next cache. Defaults to
  // .next for the normal single-instance case.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Share the @eins/ui source package across apps without a build step.
  transpilePackages: ["@eins/ui"],
  experimental: {
    // Tree-shake barrel imports from these packages.
    // - lucide-react: 16 import sites in portal pages, ~hundreds of icons total.
    // - date-fns: defensive — server-only utility imports.
    optimizePackageImports: ["lucide-react", "date-fns"],
    // Client-side Router Cache reuse window for dynamic routes. Next 15
    // defaults `dynamic` to 0, so every dashboard TimeRangeToggle does a full
    // server round-trip even when flipping back to a window viewed seconds
    // ago. 30s makes those revisits instant (served from the client cache,
    // no fetch). Pairs with SHORT_REVALIDATE_S server-side so first visits to
    // a new window are cheap too. Mutations still bust the cache via
    // revalidatePath/revalidateTag, so post-action freshness is unaffected.
    staleTimes: {
      dynamic: 30,
    },
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
