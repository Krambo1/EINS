/** @type {import('next').NextConfig} */

// HSTS is already set by Vercel at the platform level (Strict-Transport-Security:
// max-age=63072000). We add the headers Vercel does not set by default.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    // AVIF first (40-50% smaller than WebP for the portal screenshots / icons),
    // WebP fallback. Cache optimized variants on the CDN for 30 days.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2592000,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    // Canonicalize www -> apex so eins.ag is the single served host.
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.eins.ag" }],
        destination: "https://eins.ag/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
