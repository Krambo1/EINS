import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClinic } from "@/lib/clinic-registry";
import { clinicSlugForHost, isInternalHost, normalizeHost } from "@/lib/domain-map";
import { allowRequest, clientIpFromHeaders } from "@/lib/rate-limit-mem";
import { anonymizeIp, envTokenForSlug, sendMetaCapi } from "@/lib/meta-capi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side CAPI relay for non-Lead events (PageView, QuizStep, ScrollDeep).
 *
 * The browser pixel fires the same event with the same `event_id` so Meta
 * dedupes; the server-side relay survives ad-blockers and ITP, which is
 * the whole reason CAPI exists.
 */

// Field caps: unauthenticated sink, every string is attacker-controlled and
// gets forwarded to Meta. Bound them (pentest authn-08-telemetry / residual 7).
const trackSchema = z.object({
  event: z.string().min(1).max(40),
  eventId: z.string().min(1).max(128),
  sourceUrl: z.string().min(1).max(512),
  step: z.string().max(64).optional(),
  treatment: z.string().max(120).optional(),
  branch: z.string().max(120).optional(),
  // Forwarded verbatim into Meta custom_data — clamp the magnitude and pin
  // the currency to an ISO-4217 code so an unauthenticated caller can't poison
  // a clinic's conversion value with arbitrary numbers/strings (pentest H6).
  value: z.number().finite().nonnegative().max(1_000_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

const TRACK_LIMIT_PER_MINUTE = 120;

/**
 * Resolve the clinic this event belongs to from a TRUSTED signal.
 *
 * The browser-set Origin/Referer host cannot be forged by a hostile page
 * (cross-origin fetch always reveals the true origin), so we map it to a slug
 * via the registry. Only when the request comes from an internal/dev host
 * (localhost, *.vercel.app) do we fall back to the client-supplied sourceUrl
 * path / x-clinic-slug header — the old behaviour, kept for preview QA. This
 * stops an attacker on evil.com from spoofing CAPI events into a registered
 * clinic's pixel (pentest residual #7).
 */
function resolveTrustedClinicSlug(req: NextRequest, sourceUrl: string): string {
  const originHost = req.headers.get("origin") ?? req.headers.get("referer");
  if (originHost) {
    const host = normalizeHost(originHost);
    if (!isInternalHost(host)) {
      // Public custom domain: trust ONLY the registry mapping.
      return clinicSlugForHost(host) ?? "";
    }
  }
  // Internal/dev host (or no Origin): fall back to the client-supplied path.
  const url = new URL(sourceUrl, "https://example.com");
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[0] ?? req.headers.get("x-clinic-slug") ?? "";
}

export async function POST(req: NextRequest) {
  const reqIp = clientIpFromHeaders(req.headers);
  if (!allowRequest(reqIp, TRACK_LIMIT_PER_MINUTE)) {
    return new NextResponse(null, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const parse = trackSchema.safeParse(raw);
  if (!parse.success) return NextResponse.json({ ok: true });
  const ev = parse.data;

  const clinicSlug = resolveTrustedClinicSlug(req, ev.sourceUrl);
  const clinic = clinicSlug ? getClinic(clinicSlug) : null;

  if (!clinic || !clinic.connectors.metaPixelId) {
    return NextResponse.json({ ok: true });
  }
  const token = envTokenForSlug(clinic.slug);
  if (!token) return NextResponse.json({ ok: true });

  const ip = anonymizeIp(reqIp === "unknown" ? "" : reqIp);
  const ua = req.headers.get("user-agent") ?? "";

  await sendMetaCapi({
    pixelId: clinic.connectors.metaPixelId,
    accessToken: token,
    events: [
      {
        event_name: ev.event,
        event_id: ev.eventId,
        event_source_url: ev.sourceUrl,
        user_data: {
          client_ip_address: ip || undefined,
          client_user_agent: ua,
        },
        custom_data: {
          step: ev.step,
          treatment: ev.treatment,
          branch: ev.branch,
          value: ev.value,
          currency: ev.currency,
        },
      },
    ],
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
