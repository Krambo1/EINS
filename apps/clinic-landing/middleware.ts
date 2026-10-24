import { NextResponse, type NextRequest } from "next/server";
import { clinicSlugForHost, isInternalHost } from "@/lib/domain-map";
import { getTreatment } from "@/lib/clinic-registry";

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

/**
 * Old/readable treatment-slug addresses → permanent redirect to the neutral
 * urlCode address (query string kept). Ad pixels send the full page address,
 * so it must not name the treatment. Server-side, so no pixel fires on the
 * slug URL. `base` is "" on a custom domain, "/<clinicSlug>" on internal hosts.
 */
function slugRedirect(
  req: NextRequest,
  clinicSlug: string,
  segments: string[],
  base: string,
): NextResponse | null {
  const [segment, ...rest] = segments;
  if (!segment) return null;
  const treatment = getTreatment(clinicSlug, segment);
  if (!treatment || treatment.urlCode === segment) return null;
  const target = req.nextUrl.clone();
  target.pathname = [base, treatment.urlCode, ...rest].join("/");
  return NextResponse.redirect(target, 308);
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl.clone();

  if (isInternalHost(host)) {
    const [clinicSlug, ...segments] = url.pathname.split("/").filter(Boolean);
    if (clinicSlug) {
      const redirect = slugRedirect(req, clinicSlug, segments, `/${clinicSlug}`);
      if (redirect) return redirect;
    }
    return NextResponse.next();
  }

  const slug = clinicSlugForHost(host);
  if (!slug) return NextResponse.next();

  // If the URL already starts with the clinic slug, leave it alone.
  if (url.pathname === `/${slug}` || url.pathname.startsWith(`/${slug}/`)) {
    return NextResponse.next();
  }

  const redirect = slugRedirect(req, slug, url.pathname.split("/").filter(Boolean), "");
  if (redirect) return redirect;

  // Bare `praxis-mueller.de/` lands on the practice start page
  // (app/[clinicSlug]/page.tsx: neutral treatment choice, used by organic
  // links); every other path goes to `/<slug>/<path>`.
  url.pathname = url.pathname === "/" ? `/${slug}` : `/${slug}${url.pathname}`;
  return NextResponse.rewrite(url);
}
