import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  isValidTokenShape,
  recordFeedback,
  resolveReviewToken,
} from "@/server/review-tokens";

/**
 * EINS Bewertungen — POST /api/review-tokens/[token]/feedback
 *
 * Persists a patient_feedback row, marks the recall completed, and fires
 * the alert email to the Praxisinhaber:in. Same token-as-auth + per-IP
 * rate-limit model as the click endpoint.
 */

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  freeText: z.string().max(5000).optional(),
  contactBackOk: z.boolean(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
});

export async function POST(
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
    trustedIpFromHeaders(
      request.headers.get("x-forwarded-for"),
      request.headers.get("x-real-ip")
    ) ?? "anon";
  // Tighter limit: feedback is the only write that creates a persistent
  // row visible to clinic staff. 10/min is enough to retry an actual
  // submit a couple of times without enabling spam.
  const rl = await rateLimit("review-tokens-feedback", ip, {
    limit: 10,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }

  const recall = await resolveReviewToken(token);
  if (!recall) {
    return NextResponse.json(
      { error: { code: "not_found" } },
      { status: 404 }
    );
  }

  const result = await recordFeedback(token, {
    rating: parsed.rating,
    freeText: parsed.freeText ?? null,
    contactBackOk: parsed.contactBackOk,
    contactName: parsed.contactName ?? null,
    contactEmail: parsed.contactEmail ?? null,
  });
  if (!result.ok) {
    if (result.reason === "unsubscribed") {
      // The patient unsubscribed from this clinic; their token is dead.
      // 410 Gone is the precise status (the resource is intentionally
      // permanently unavailable), and we hand the client a translatable
      // code so the UI can show "Du hast dich abgemeldet" rather than a
      // generic error.
      return NextResponse.json(
        { error: { code: "unsubscribed" } },
        { status: 410 }
      );
    }
    if (result.reason === "not_found") {
      return NextResponse.json(
        { error: { code: "not_found" } },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: { code: "invalid_request" } },
      { status: 400 }
    );
  }

  // Only audit + return 201 on the first successful submission. A replay
  // returns 200 + the existing feedbackId so an idempotent client (PWA
  // resubmit, double-tap) sees a stable result without spamming the audit
  // log or duplicating the Praxis-side alert email.
  if (!result.replayed) {
    await writeAudit({
      clinicId: recall.clinicId,
      action: "patient_feedback_create",
      entityKind: "patient_feedback",
      entityId: result.feedbackId,
      diff: {
        rating: parsed.rating,
        contactBackOk: parsed.contactBackOk,
        hasFreeText: Boolean(parsed.freeText),
      },
    });
  }

  return NextResponse.json(
    { ok: true, feedbackId: result.feedbackId, replayed: result.replayed },
    { status: result.replayed ? 200 : 201 }
  );
}
