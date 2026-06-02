import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import {
  resolveReviewToken,
  isValidTokenShape,
  resolveGoogleReviewTarget,
} from "@/server/review-tokens";

/**
 * EINS Bewertungen — GET /api/review-tokens/[token]
 *
 * Resolves an opaque review token into the clinic context needed to render
 * the patient-facing rating landing on clinic-landing. Called server-to-
 * server from the landing page on initial render.
 *
 * Auth: the 32-byte token itself is the credential (cf. server/review-tokens.ts).
 * IP rate-limit (60/min) blunts scraping. Response intentionally minimal so
 * a probe with a guessed token learns ~nothing beyond "token bad/good".
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;

  if (!isValidTokenShape(token)) {
    return notFound();
  }

  const ip =
    (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "anon") || "anon";
  const rl = await rateLimit("review-tokens-get", ip, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
    );
  }

  const recall = await resolveReviewToken(token);
  if (!recall) return notFound();

  // Resolve the canonical Google write-review URL up here so the same logic
  // is reused by the public-click redirector (which calls this endpoint).
  // A configured "search.google.com/search?q=..." fallback is rejected —
  // patients hit a write-review prompt or they hit nothing.
  const resolvedGoogleUrl = resolveGoogleReviewTarget({
    googlePlaceId: recall.googlePlaceId,
    googleReviewUrl: recall.googleReviewUrl,
  });

  const suggestedPlatform: "google" | "jameda" | null = resolvedGoogleUrl
    ? "google"
    : recall.jamedaReviewUrl
    ? "jameda"
    : null;

  return NextResponse.json(
    {
      clinic: {
        displayName: recall.clinicName,
        googleReviewUrl: resolvedGoogleUrl,
        jamedaReviewUrl: recall.jamedaReviewUrl,
        suggestedPlatform,
      },
      recall: {
        recordedRating: recall.ratingValue,
        ratingClickedAt: recall.ratingClickedAt?.toISOString() ?? null,
        publicClickedAt: recall.publicClickedAt?.toISOString() ?? null,
        feedbackAt: recall.feedbackAt?.toISOString() ?? null,
      },
      patient: {
        firstName: recall.patientName,
      },
    },
    { status: 200 }
  );
}

function notFound() {
  return NextResponse.json(
    { error: { code: "not_found" } },
    { status: 404 }
  );
}
