import { NextResponse, type NextRequest } from "next/server";
import { ACTION_FLASH_COOKIE } from "@/lib/flash";

/**
 * Edge middleware — runs on every request BEFORE server components render.
 *
 * We deliberately keep this minimal because edge functions can't reach
 * Postgres. Real session validation happens inside server components via
 * `requireSession()` from `@/auth/guards`. Here we:
 *
 *   1. Route requests from the `admin.*` host to `/admin/*` transparently
 *      so the admin panel lives at a different origin than the clinic app.
 *   2. Reject everything pointing at `/admin/*` from the regular (non-admin)
 *      host. Prevents accidental exposure.
 *   3. Clear the one-shot action-flash cookie on the response so the toast
 *      only fires once. (The layout reads it on this request; we delete it
 *      from the response since Server Components can't mutate cookies in
 *      Next 15.)
 */

/** Custom REQUEST header forwarded by middleware so server components can
 *  read the current pathname via `headers()` without relying on the
 *  un-stable `x-invoke-path` / `next-url` headers Next sets internally. */
const PATHNAME_HEADER = "x-portal-pathname";

/** Builds the per-request headers we forward to server components. */
function forwardedHeaders(req: NextRequest): Headers {
  const h = new Headers(req.headers);
  h.set(PATHNAME_HEADER, req.nextUrl.pathname);
  return h;
}

function withFlashCleared(res: NextResponse, shouldClear: boolean): NextResponse {
  if (shouldClear) res.cookies.delete(ACTION_FLASH_COOKIE);
  return res;
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Files in `public/` (e.g. `/eins-logo.svg`, `/fonts/foo.woff2`) bypass
  // host-aware rewriting. Without this, a request to `/eins-logo.svg` on
  // the admin host gets rewritten to `/admin/eins-logo.svg` and 404s.
  if (/\.[^/]+$/.test(url.pathname)) {
    return NextResponse.next();
  }

  // API routes are host-agnostic: the auth/permission gate lives in the
  // route handler (requireAdminForApi / requireSessionForApi). Without
  // this bypass, an `/api/admin/...` call on the admin host would be
  // rewritten to `/admin/api/admin/...` — a path Next can't resolve, so
  // every admin-side fetch (DSGVO download, PVS event detail, replay)
  // 404s.
  if (url.pathname.startsWith("/api/")) {
    return NextResponse.next({
      request: { headers: forwardedHeaders(req) },
    });
  }

  // Only clear the flash on top-level navigations (GET HTML), not on
  // Server Action POSTs / data fetches — those are the ones that *set* it.
  const isNav =
    req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");
  const clearFlash = isNav && req.cookies.has(ACTION_FLASH_COOKIE);

  const host = req.headers.get("host") ?? "";
  const isAdminHost = /^admin\./i.test(host);
  const isAdminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/");

  const headers = forwardedHeaders(req);

  if (isAdminHost) {
    // If the request is to the admin host but NOT already under /admin,
    // rewrite to /admin/<rest>. Keeps all admin routes behind a single dir.
    if (!isAdminPath) {
      const rewritten = url.clone();
      rewritten.pathname = `/admin${url.pathname === "/" ? "" : url.pathname}`;
      return withFlashCleared(
        NextResponse.rewrite(rewritten, { request: { headers } }),
        clearFlash
      );
    }
    return withFlashCleared(
      NextResponse.next({ request: { headers } }),
      clearFlash
    );
  }

  // Regular host: do not let anyone poke at /admin/*
  if (isAdminPath) {
    const notFound = url.clone();
    notFound.pathname = "/404";
    return withFlashCleared(
      NextResponse.rewrite(notFound, { request: { headers } }),
      clearFlash
    );
  }

  return withFlashCleared(
    NextResponse.next({ request: { headers } }),
    clearFlash
  );
}

export const config = {
  // Skip Next internals, static assets, the health probe, the
  // high-traffic web-vitals beacon (fires on every page nav and gains
  // nothing from middleware's host/flash logic), and the dev upload sink:
  // when middleware runs on a route, Next tees the request body with an
  // internal ~10 MiB cap and SILENTLY TRUNCATES anything bigger — a 20 MB
  // file arrives as 10 MiB with no error. /api/uploads takes raw file
  // bytes (local-driver direct uploads), so it must bypass middleware
  // entirely; its auth lives in the handler like api/health.
  matcher: [
    "/((?!_next/|favicon\\.ico|api/health|api/vitals|api/uploads|robots\\.txt|sitemap\\.xml).*)",
  ],
};
