import { NextResponse, type NextRequest } from "next/server";
import {
  isValidTokenShape,
  postClick,
  resolveToken,
} from "@/lib/portal-review-tokens";

/**
 * EINS Stimme — public-click redirector.
 *
 * Records the platform click on the portal, then 302s the patient to the
 * configured Google / Jameda review URL. We do the round-trip server-side
 * so JS-disabled mail readers still get tracked and the link in the
 * landing page can render as a regular `<a href>`.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: { token: string } }
) {
  const { token } = ctx.params;
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
    return NextResponse.json(
      { error: "platform_not_configured" },
      { status: 404 }
    );
  }

  // Fire-and-forget — we don't block the redirect on the click ping.
  await postClick(token, { target: "public", platform });

  return NextResponse.redirect(target, { status: 302 });
}
