import { NextResponse, type NextRequest } from "next/server";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  patientPage,
  resolveRetreatmentToken,
  unsubscribeRetreatmentToken,
} from "@/server/retreatment-tokens";

/**
 * Wiederbehandlungs-Kalender: /api/retreatment-tokens/[token]/unsubscribe
 *
 *   GET  = the footer link: a page with ONE button. Not an instant
 *          unsubscribe, because mail security scanners (Outlook Safe Links
 *          and similar) open every link in a mail and would silently
 *          unsubscribe every patient.
 *   POST = the button, and RFC 8058 one-click (List-Unsubscribe-Post from
 *          Gmail/Yahoo/Apple Mail). Suppresses the address for marketing
 *          mail of this Praxis; appointment mail still arrives.
 */
async function limited(request: NextRequest) {
  const ip =
    trustedIpFromHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")) ??
    "anon";
  return rateLimit("retreatment-tokens-unsubscribe", ip, { limit: 20, windowSeconds: 600 });
}

const NOT_FOUND = () =>
  html(
    patientPage({
      title: "Link nicht gefunden",
      heading: "Dieser Link ist nicht mehr gültig.",
      body: ["Wenn Sie keine Erinnerungen mehr möchten, schreiben Sie bitte kurz an Ihre Praxis."],
    }),
    404
  );

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const rl = await limited(request);
  if (!rl.ok) return tooMany(rl.resetInSeconds);
  const { token } = await ctx.params;
  const resolved = await resolveRetreatmentToken(token);
  if (!resolved) return NOT_FOUND();
  return html(
    patientPage({
      title: "Erinnerungen abbestellen",
      heading: "Erinnerungen abbestellen",
      body: [
        `Möchten Sie keine Termin-Erinnerungen mehr von ${resolved.clinicName} per E-Mail erhalten?`,
        "Bestätigungen zu Terminen, die Sie selbst vereinbaren, bekommen Sie weiterhin.",
      ],
      confirmLabel: "Keine Erinnerungen mehr",
    }),
    200
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const rl = await limited(request);
  if (!rl.ok) return tooMany(rl.resetInSeconds);
  const { token } = await ctx.params;
  const resolved = await resolveRetreatmentToken(token);
  if (!resolved) return NOT_FOUND();

  const ok = await unsubscribeRetreatmentToken(resolved);
  if (ok) {
    await writeAudit({
      clinicId: resolved.clinicId,
      action: "patient_unsubscribe",
      entityKind: "patient",
      entityId: resolved.patientId,
      diff: { source: "retreatment_token" },
    });
  }

  return html(
    patientPage({
      title: "Abgemeldet",
      heading: ok ? "Sie sind abgemeldet." : "Abmeldung nicht möglich",
      body: ok
        ? [
            `Sie erhalten keine Erinnerungen und keine Bewertungsanfragen mehr von ${resolved.clinicName} per E-Mail.`,
          ]
        : ["Wir konnten Ihre E-Mail-Adresse nicht zuordnen. Bitte schreiben Sie kurz an Ihre Praxis."],
    }),
    200
  );
}

function tooMany(retryAfter: number) {
  return new NextResponse("Zu viele Anfragen. Bitte versuchen Sie es gleich noch einmal.", {
    status: 429,
    headers: { "Retry-After": String(retryAfter) },
  });
}

function html(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
