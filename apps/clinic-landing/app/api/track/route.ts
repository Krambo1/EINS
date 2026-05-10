import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClinic } from "@/lib/clinic-registry";
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

const trackSchema = z.object({
  event: z.string().min(1).max(40),
  eventId: z.string().min(1),
  sourceUrl: z.string().min(1),
  step: z.string().optional(),
  treatment: z.string().optional(),
  branch: z.string().optional(),
  value: z.number().optional(),
  currency: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const parse = trackSchema.safeParse(raw);
  if (!parse.success) return NextResponse.json({ ok: true });
  const ev = parse.data;

  // Derive clinic from URL — best-effort; no PII required for non-Lead events.
  const url = new URL(ev.sourceUrl, "https://example.com");
  const segments = url.pathname.split("/").filter(Boolean);
  const clinicSlug =
    segments[0] ??
    req.headers.get("x-clinic-slug") ??
    "";
  const clinic = clinicSlug ? getClinic(clinicSlug) : null;

  if (!clinic || !clinic.connectors.metaPixelId) {
    return NextResponse.json({ ok: true });
  }
  const token = envTokenForSlug(clinic.slug);
  if (!token) return NextResponse.json({ ok: true });

  const ip = anonymizeIp(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "");
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
