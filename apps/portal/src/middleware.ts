import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware — runs on every request BEFORE server components render.
 *
 * We deliberately keep this minimal because edge functions can't reach
 * Postgres. Real session validation happens inside server components via
 * `requireSession()` from `@/auth/guards`. Here we only:
 *
 *   1. Route requests from the `admin.*` host to `/admin/*` transparently
 *      so the admin panel lives at a different origin than the clinic app.
 *   2. Reject everything pointing at `/admin/*` from the regular (non-admin)
 *      host. Prevents accidental exposure.
 */

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Files in `public/` (e.g. `/eins-logo.svg`, `/fonts/foo.woff2`) bypass
  // host-aware rewriting. Without this, a request to `/eins-logo.svg` on
  // the admin host gets rewritten to `/admin/eins-logo.svg` and 404s.
  if (/\.[^/]+$/.test(url.pathname)) {
    return NextResponse.next();
  }

  const host = req.headers.get("host") ?? "";
  const isAdminHost = /^admin\./i.test(host);
  const isAdminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/");

  if (isAdminHost) {
    // If the request is to the admin host but NOT already under /admin,
    // rewrite to /admin/<rest>. Keeps all admin routes behind a single dir.
    if (!isAdminPath) {
      const rewritten = url.clone();
      rewritten.pathname = `/admin${url.pathname === "/" ? "" : url.pathname}`;
      return NextResponse.rewrite(rewritten);
    }
    return NextResponse.next();
  }

  // Regular host: do not let anyone poke at /admin/*
  if (isAdminPath) {
    const notFound = url.clone();
    notFound.pathname = "/404";
    return NextResponse.rewrite(notFound);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, static assets, and the callback endpoint.
  matcher: [
    "/((?!_next/|favicon\\.ico|api/health|robots\\.txt|sitemap\\.xml).*)",
  ],
};
