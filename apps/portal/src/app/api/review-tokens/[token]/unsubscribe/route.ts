import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  isValidTokenShape,
  resolveReviewToken,
  unsubscribeViaToken,
} from "@/server/review-tokens";

/**
 * EINS Bewertungen — POST /api/review-tokens/[token]/unsubscribe
 *
 * Honors the one-click unsubscribe in every review-request email.
 *
 * Same token-as-auth model. Note that we ACCEPT both GET and POST here:
 * §7 UWG + RFC 8058 "one-click unsubscribe" must work without further
 * confirmation, and most mail clients fire a GET when the user clicks
 * the footer link. We're still careful to require a POST when the
 * unsubscribe is triggered programmatically (e.g. mail clients that
 * implement List-Unsubscribe-Post).
 */
async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!isValidTokenShape(token)) {
    return NextResponse.json(
      { error: { code: "not_found" } },
      { status: 404 }
    );
  }

  const ip =
    (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "anon") || "anon";
  const rl = await rateLimit("review-tokens-unsubscribe", ip, {
    limit: 20,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
    );
  }

  const recall = await resolveReviewToken(token);
  const result = await unsubscribeViaToken(token);

  if (recall) {
    await writeAudit({
      clinicId: recall.clinicId,
      action: "patient_unsubscribe",
      entityKind: "patient",
      entityId: recall.patientId ?? undefined,
      diff: { source: "review_token" },
    });
  }

  return NextResponse.json(
    { ok: result.ok, clinicName: result.clinicName ?? null },
    { status: 200 }
  );
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  return handle(request, ctx);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  return handle(request, ctx);
}
