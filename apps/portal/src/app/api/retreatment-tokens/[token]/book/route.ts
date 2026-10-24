import { NextResponse, type NextRequest } from "next/server";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { rateLimit } from "@/server/rate-limit";
import {
  patientPage,
  recordBookingClick,
  resolveRetreatmentToken,
  safeBookingTarget,
} from "@/server/retreatment-tokens";

/**
 * Wiederbehandlungs-Kalender: GET /api/retreatment-tokens/[token]/book
 *
 * The "Termin buchen" button in the reminder email. Records the first click
 * (so the portal can show "hat den Buchungslink geöffnet") and redirects to
 * the Praxis's own booking page. Token-as-auth, public.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const ip =
    trustedIpFromHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")) ??
    "anon";
  const rl = await rateLimit("retreatment-tokens-book", ip, { limit: 30, windowSeconds: 600 });
  if (!rl.ok) {
    return new NextResponse("Zu viele Anfragen. Bitte versuchen Sie es gleich noch einmal.", {
      status: 429,
      headers: { "Retry-After": String(rl.resetInSeconds) },
    });
  }

  const resolved = await resolveRetreatmentToken(token);
  if (!resolved) {
    return html(
      patientPage({
        title: "Link nicht gefunden",
        heading: "Dieser Link ist nicht mehr gültig.",
        body: ["Bitte wenden Sie sich direkt an Ihre Praxis."],
      }),
      404
    );
  }

  await recordBookingClick(resolved.id);

  const target = safeBookingTarget(resolved.bookingUrl);
  if (target) return NextResponse.redirect(target, 302);

  return html(
    patientPage({
      title: resolved.clinicName,
      heading: "Termin vereinbaren",
      body: resolved.phone
        ? [`Rufen Sie ${resolved.clinicName} gerne an: ${resolved.phone}`]
        : [`Bitte wenden Sie sich direkt an ${resolved.clinicName}.`],
    }),
    200
  );
}

function html(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
