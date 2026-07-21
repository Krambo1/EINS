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
  // The R2 storage driver + db-backup worker load these via dynamic
  // `import(/* webpackIgnore */ ...)`, so webpack never bundles them. Marking
  // them server-external makes Next's output file-tracing ship them into the
  // serverless function bundle; without this the import resolves fine locally
  // but throws "Cannot find module" on Vercel once STORAGE_DRIVER=r2.
  serverExternalPackages: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  experimental: {
    // File uploads go direct-to-storage (presigned R2 PUT, see
    // server/uploads.ts), so server actions only ever carry metadata — but
    // the avatar cropper still posts up to 2 MB of WebP through an action,
    // and Next's 1 MB default rejected it. 10 MB gives headroom locally;
    // note Vercel itself caps request bodies at ~4.5 MB regardless.
    serverActions: {
      bodySizeLimit: "10mb",
    },
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
  // Security headers (pentest L5).
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
          // App-level HSTS in addition to the Cloudflare edge header, so a
          // request that reaches the Vercel origin directly (e.g. the raw
          // *.vercel.app host, bypassing the edge) still gets the policy.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // Content-Security-Policy — deliberately scoped to the directives
          // that are safe to enforce app-wide without a nonce pipeline:
          //   • frame-ancestors 'none' — clickjacking lock (modern equivalent
          //     of X-Frame-Options, which is kept for older browsers).
          //   • base-uri 'self' — blocks <base> tag injection from re-pointing
          //     relative URLs.
          //   • object-src 'none' — no Flash/plugin embedding.
          // We intentionally do NOT restrict script-src/style-src (Next.js
          // injects inline bootstrap/hydration scripts; a strict policy needs
          // per-request nonces threaded through middleware — a separate, larger
          // change) and do NOT set form-action (the admin "view as user"
          // hand-off POSTs cross-origin from the admin host to the clinic host).
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})(config);
