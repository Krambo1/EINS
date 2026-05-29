import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  isValidTokenShape,
  recordPublicClick,
  recordRatingClick,
  resolveReviewToken,
} from "@/server/review-tokens";

/**
 * EINS Stimme — POST /api/review-tokens/[token]/click
 *
 * Three flavours, selected by body `target`:
 *   • "land"    → patient hit /r/<token>?rating=N — record the rating tap.
 *   • "public"  → patient is being redirected to Google/Jameda — log it.
 *   • "private" → patient opened the private form — log it (no DB mutate
 *                 needed beyond the 'land' rating; only present for parity).
 *
 * Same token-as-auth + IP rate-limit model as the GET route.
 */

const Body = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  target: z.enum(["land", "public", "private"]),
  platform: z.enum(["google", "jameda"]).optional(),
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
    (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "anon") || "anon";
  const rl = await rateLimit("review-tokens-click", ip, {
    limit: 30,
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

  const reviewRequest = await resolveReviewToken(token);
  if (!reviewRequest) {
    return NextResponse.json(
      { error: { code: "not_found" } },
      { status: 404 }
    );
  }

  if (parsed.target === "land" && typeof parsed.rating === "number") {
    await recordRatingClick(token, parsed.rating);
  }
  if (parsed.target === "public" && parsed.platform) {
    await recordPublicClick(token, parsed.platform);
  }

  await writeAudit({
    clinicId: reviewRequest.clinicId,
    action: "review_click",
    entityKind: "review_request",
    entityId: reviewRequest.reviewRequestId,
    diff: {
      target: parsed.target,
      rating: parsed.rating ?? null,
      platform: parsed.platform ?? null,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
