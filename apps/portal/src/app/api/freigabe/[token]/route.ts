import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { decideApprovalByToken, isApprovalTokenShape } from "@/server/content-approval";
import { trustedIpFromHeaders } from "@/lib/client-ip";

/**
 * POST /api/freigabe/[token]: the decision of the public approval page
 * (/freigabe/[token]). Form post, answered with a 303 back to the page, which
 * then shows the recorded decision (also on a replay: the first decision
 * wins, a second one is not an error).
 *
 * Token-as-credential like /api/review-tokens: shape check, sha256 lookup,
 * expiry (decideApproval), per-IP rate limit. For a clone post the link is
 * valid only because the e-mail carrying it went to Inhaber users only
 * (server/content-approval.ts); decided_by_user_id stays null, decided_via
 * 'link'.
 */

function back(request: NextRequest, token: string, fehler?: string): NextResponse {
  const url = new URL(`/freigabe/${token}`, request.nextUrl.origin);
  if (fehler) url.searchParams.set("fehler", fehler);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isApprovalTokenShape(token)) return new NextResponse("Not Found", { status: 404 });

  const ip = trustedIpFromHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
  const rl = await rateLimit("content-approval-decide", ip ?? "unknown", { limit: 10, windowSeconds: 60 });
  if (!rl.ok) return back(request, token, "zu_viele");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, token, "ungueltig");
  }
  const decision = form.get("decision");
  const changeText = form.get("changeText");

  const result = await decideApprovalByToken(token, decision, typeof changeText === "string" ? changeText : null, {
    ip,
    ua: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    if (result.reason === "expired") return back(request, token, "abgelaufen");
    if (result.reason === "invalid") return back(request, token, decision === "aenderung" ? "text" : "ungueltig");
    return back(request, token);
  }
  return back(request, token);
}
