import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { normalizeAllowedLandingOrigin } from "@/lib/review-url-allowlist";
import { reviewRateLimitIp } from "@/lib/review-relay-ip";
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
 * Same token-as-auth model. POST unsubscribes: RFC 8058 one-click from the
 * List-Unsubscribe header (Gmail/Yahoo/Apple Mail) and the button on the
 * clinic-landing confirmation page. GET only redirects to that page (see
 * GET below). Works for expired tokens too (E-18).
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

  // J-8: patient IP signed by clinic-landing, else the caller's IP.
  const ip = reviewRateLimitIp(request, token);
  // Generous: RFC 8058 one-click POSTs come from the mail provider's shared
  // IPs (Gmail), and the 64-hex token cannot be guessed anyway.
  const rl = await rateLimit("review-tokens-unsubscribe", ip, {
    limit: 200,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
    );
  }

  const recall = await resolveReviewToken(token, { allowExpired: true });
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

/**
 * GET never unsubscribes (B-22): mail security scanners open every link and
 * would silently opt patients out. A browser that opens the List-Unsubscribe
 * URL lands on the confirmation page with one button (clinic-landing
 * /r/unsubscribe), which then POSTs here.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!isValidTokenShape(token)) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const [row] = await db
    .select({ origin: schema.clinics.reviewLandingOrigin })
    .from(schema.reviewEmailSchedule)
    .innerJoin(schema.clinics, eq(schema.reviewEmailSchedule.clinicId, schema.clinics.id))
    .where(eq(schema.reviewEmailSchedule.reviewToken, token))
    .limit(1);
  // J-4: a stored origin outside the allowlist (saved before the check
  // existed) falls back to the EINS default instead of redirecting there.
  const stored = row?.origin
    ? normalizeAllowedLandingOrigin(
        row.origin,
        env.CLINIC_LANDING_ORIGIN,
        env.CLINIC_LANDING_ORIGINS
      )
    : null;
  const origin = (stored ?? env.CLINIC_LANDING_ORIGIN).replace(/\/$/, "");
  return NextResponse.redirect(
    `${origin}/r/unsubscribe?token=${encodeURIComponent(token)}`,
    303
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  return handle(request, ctx);
}
