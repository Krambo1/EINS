import { NextResponse, type NextRequest } from "next/server";
import {
  isValidTokenShape,
  postFeedback,
} from "@/lib/portal-review-tokens";

/**
 * EINS Stimme — same-origin proxy from the client feedback form to the
 * portal's /api/review-tokens/[token]/feedback endpoint.
 *
 * We could let the browser hit the portal directly, but that demands a
 * CORS allowlist per clinic domain. Going via a clinic-landing route
 * keeps the portal endpoint same-origin and lets us 1:1 forward the
 * (already-validated) payload server-to-server.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: { token: string } }
) {
  const { token } = ctx.params;
  if (!isValidTokenShape(token)) {
    return NextResponse.json({ error: "bad_token" }, { status: 400 });
  }

  let body: {
    rating: number;
    freeText?: string;
    contactBackOk: boolean;
    contactName?: string;
    contactEmail?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // Light client-side coercion — portal does the real Zod validation.
  if (
    !Number.isInteger(body.rating) ||
    body.rating < 1 ||
    body.rating > 5 ||
    typeof body.contactBackOk !== "boolean"
  ) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const res = await postFeedback(token, body);
  if (!res.ok) {
    return NextResponse.json({ error: "portal_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, feedbackId: res.feedbackId });
}
