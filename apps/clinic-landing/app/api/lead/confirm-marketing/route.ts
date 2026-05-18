import { NextResponse, type NextRequest } from "next/server";
import { getClinic, getTreatment } from "@/lib/clinic-registry";
import { postMarketingConfirmed, webhookUrlForClinic } from "@/lib/crm";
import { markConfirmedOnce, verifyDoiToken } from "@/lib/doi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/lead/confirm-marketing?t=<signed-token>
 *
 * Step 2 of the double-opt-in dance:
 *   1. Verify HMAC signature + expiry (token is self-contained, no DB lookup).
 *   2. Fire a `marketing-confirmed` follow-up event to the same clinic webhook,
 *      so the CRM can flip the contact from pending → confirmed.
 *   3. Redirect the patient to a branded success page (or /lead/expired on failure).
 *
 * The webhook call is best-effort — if the CRM is down we still show success to
 * the patient (we accepted the consent; downstream recovery is on the operator).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (!token) {
    return NextResponse.redirect(new URL("/lead/expired", req.url));
  }

  const verified = verifyDoiToken(token);
  if (!verified.ok) {
    return NextResponse.redirect(new URL("/lead/expired", req.url));
  }

  const { claims } = verified;
  const clinic = getClinic(claims.c);
  const treatment = getTreatment(claims.c, claims.t);
  if (!clinic || !treatment) {
    return NextResponse.redirect(new URL("/lead/expired", req.url));
  }

  // Idempotency on the original eventId so a double-click doesn't double-fire.
  if (markConfirmedOnce(claims.id)) {
    const webhookUrl = webhookUrlForClinic(clinic.slug, clinic.connectors.webhookUrl);
    if (webhookUrl) {
      await postMarketingConfirmed(webhookUrl, {
        type: "marketing-confirmed",
        source: "clinic-landing",
        receivedAt: new Date().toISOString(),
        clinic: clinic.slug,
        treatment: treatment.slug,
        patient: { email: claims.e },
        eventId: claims.id,
        marketingConfirmedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  const success = new URL("/lead/confirmed", req.url);
  success.searchParams.set("clinic", clinic.slug);
  return NextResponse.redirect(success);
}
