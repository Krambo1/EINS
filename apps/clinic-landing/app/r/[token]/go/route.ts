import { NextResponse, type NextRequest } from "next/server";
import {
  isValidTokenShape,
  postClick,
  resolveToken,
} from "@/lib/portal-review-tokens";

/**
 * Host allowlist for the public review redirect target. The Praxis sets
 * `googleReviewUrl` / `jamedaReviewUrl` in the portal; without this an inhaber
 * (or a compromised portal) could 302 patients to an arbitrary phishing host
 * under the EINS-branded link (pentest M9 / az-04). https-only + known
 * review-provider hosts.
 */
function isAllowedReviewTarget(
  platform: "google" | "jameda",
  url: string
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (platform === "jameda") {
    return host === "jameda.de" || host.endsWith(".jameda.de");
  }
  // google
  return (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "g.page" ||
    host.endsWith(".g.page") ||
    host === "maps.app.goo.gl" ||
    host === "goo.gl"
  );
}

/**
 * EINS Bewertungen — public-click redirector.
 *
 * POST (the CTA buttons on /r/<token> are small forms): books the star the
 * patient picked (hidden field `rating`, if any) and the platform click on
 * the portal, then 303s to the configured Google / Jameda review URL.
 * Server-side, so it works without JS.
 *
 * GET only redirects and records nothing: a mail or link scanner that
 * follows the URL must not create a rating or a public click (E-31).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: { token: string } }
) {
  return handle(request, ctx.params.token, null);
}

export async function POST(
  request: NextRequest,
  ctx: { params: { token: string } }
) {
  let rating: number | null = null;
  try {
    const n = Number((await request.formData()).get("rating"));
    if (Number.isInteger(n) && n >= 1 && n <= 5) rating = n;
  } catch {
    // no form body: still a deliberate click, record the platform only
  }
  return handle(request, ctx.params.token, { rating });
}

async function handle(
  request: NextRequest,
  token: string,
  record: { rating: number | null } | null
) {
  if (!isValidTokenShape(token)) {
    return NextResponse.json({ error: "bad_token" }, { status: 400 });
  }

  const platformRaw = request.nextUrl.searchParams.get("platform");
  if (platformRaw !== "google" && platformRaw !== "jameda") {
    return NextResponse.json({ error: "bad_platform" }, { status: 400 });
  }
  const platform = platformRaw;

  const data = await resolveToken(token);
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const target =
    platform === "google"
      ? data.clinic.googleReviewUrl
      : data.clinic.jamedaReviewUrl;

  if (!target) {
    // The Praxis hasn't configured this platform's review URL. Round 2
    // testing flagged the previous behavior (JSON-on-white 404) as a UX
    // dead-end: the patient clicks a CTA on a German-language page and
    // gets a raw JSON blob. Redirect back to the rating landing with a
    // query param the page can render a friendly inline notice from.
    const back = new URL(`/r/${token}`, request.nextUrl.origin);
    back.searchParams.set("err", "platform_not_configured");
    back.searchParams.set("p", platform);
    return NextResponse.redirect(back, { status: 303 });
  }

  if (!isAllowedReviewTarget(platform, target)) {
    // Configured URL is not a recognised review-provider host — refuse the
    // open redirect and bounce back to the rating page (pentest M9).
    const back = new URL(`/r/${token}`, request.nextUrl.origin);
    back.searchParams.set("err", "invalid_review_url");
    back.searchParams.set("p", platform);
    return NextResponse.redirect(back, { status: 303 });
  }

  if (record) {
    // Rating first, so the portal's public_redirect inbox row carries it.
    // postClick never throws (failures are logged), the redirect always runs.
    if (record.rating !== null) {
      await postClick(token, { target: "land", rating: record.rating });
    }
    await postClick(token, { target: "public", platform });
  }

  // 303 so a POST turns into a plain GET on the review site.
  return NextResponse.redirect(target, { status: 303 });
}
