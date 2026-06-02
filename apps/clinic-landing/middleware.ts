import { NextResponse, type NextRequest } from "next/server";
import { clinicSlugForHost, isInternalHost } from "@/lib/domain-map";

/**
 * Multi-tenant host rewrite.
 *
 * Patient sees: https://praxis-mueller.de/botox-muenchen
 * Server routes: /praxis-mueller-muenchen/botox-muenchen
 *
 * For internal hosts (localhost, *.vercel.app) we don't rewrite — the
 * `/<slug>/<treatment>` URL is already correct and we want it browsable.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next assets)
     * - favicon, robots, sitemap (well-known)
     * - any file with an extension (jpg, css, woff2, ...)
     * - api routes (handled directly)
     * - r/* (EINS Bewertungen review-request landing — clinic context is resolved
     *        via the opaque review token in the URL, not via host rewrite)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|api/|r/|.*\\..*).*)",
  ],
};

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl.clone();

  if (isInternalHost(host)) return NextResponse.next();

  const slug = clinicSlugForHost(host);
  if (!slug) return NextResponse.next();

  // If the URL already starts with the clinic slug, leave it alone.
  if (url.pathname === `/${slug}` || url.pathname.startsWith(`/${slug}/`)) {
    return NextResponse.next();
  }

  // Rewrite root to the clinic's first treatment? No — we 404 the bare apex.
  // Patients only ever land via ad URLs which carry a treatment slug.
  // Bare `praxis-mueller.de/` should redirect to a sensible default OR show
  // a small landing page; here we rewrite to the clinic root which currently
  // 404s — the clinic publishes specific treatment URLs, not generic ones.
  url.pathname = `/${slug}${url.pathname}`;
  return NextResponse.rewrite(url);
}
