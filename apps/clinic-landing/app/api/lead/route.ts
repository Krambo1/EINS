import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClinic, getTreatment } from "@/lib/clinic-registry";
import { pickAdapter, webhookUrlForClinic } from "@/lib/crm";
import { sendDoiEmail, signDoiToken } from "@/lib/doi";
import { idempotencyKey } from "@/lib/idempotency";
import {
  anonymizeIp,
  envTokenForSlug,
  hashEmail,
  hashName,
  hashPhone,
  sendMetaCapi,
} from "@/lib/meta-capi";
import { sendToPortal } from "@/lib/portal-intake";
import type { QuizSubmissionPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lead intake.
 *
 * 1. Validate payload server-side (zod)
 * 2. Compute idempotency hash; drop duplicates within the same UTC day
 * 3. POST to clinic webhook via configured adapter (HubSpot / GHL / raw)
 * 4. Mirror to Meta CAPI server-side, deduped via event_id
 * 5. Return { ok: true, eventId }
 *
 * IMPORTANT: webhook + CAPI are best-effort — we never block the patient on
 * a downstream slowdown. If both fail we still return ok=true and log the
 * error; the lead lives in our access log either way.
 */

const submissionSchema = z.object({
  clinicSlug: z.string().regex(/^[a-z0-9-_]+$/),
  treatmentSlug: z.string().regex(/^[a-z0-9-]+$/),
  branch: z.enum(["qualified", "info-only"]),
  treatment: z.string().min(1),
  timeframe: z.string().optional(),
  experience: z.string().optional(),
  city: z.string().max(80).optional(),
  firstName: z.string().min(1).max(60).optional(),
  email: z.string().email().max(120),
  phone: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  consents: z.object({
    privacy: z.literal(true, {
      errorMap: () => ({ message: "consents.privacy must be true" }),
    }),
    ageGate: z.literal(true, {
      errorMap: () => ({ message: "consents.ageGate must be true" }),
    }),
    marketing: z.boolean(),
    aiProcessing: z.boolean(),
  }),
  marketingConfirmedAt: z.null().optional(),
  meta: z.object({
    eventId: z.string().min(1),
    sourceUrl: z.string().min(1),
    utm: z.record(z.string()).optional(),
    fbc: z.string().optional(),
    fbp: z.string().optional(),
    ua: z.string().optional(),
  }),
});

const SEEN_KEYS = new Map<string, number>();
const DEDUP_WINDOW_MS = 1000 * 60 * 60 * 6; // 6 hours

function rememberKey(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of SEEN_KEYS.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) SEEN_KEYS.delete(k);
  }
  if (SEEN_KEYS.has(key)) return false;
  SEEN_KEYS.set(key, now);
  return true;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "";
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parse = submissionSchema.safeParse(raw);
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parse.error.flatten() },
      { status: 400 },
    );
  }
  const payload = parse.data as QuizSubmissionPayload;

  const clinic = getClinic(payload.clinicSlug);
  const treatment = getTreatment(payload.clinicSlug, payload.treatmentSlug);
  if (!clinic || !treatment) {
    return NextResponse.json({ error: "unknown_clinic_or_treatment" }, { status: 404 });
  }

  const dedupKey = idempotencyKey(payload.email, payload.treatmentSlug);
  const fresh = rememberKey(dedupKey);

  const webhookUrl = webhookUrlForClinic(clinic.slug, clinic.connectors.webhookUrl);
  const ip = anonymizeIp(clientIp(req));
  const ua = payload.meta.ua ?? req.headers.get("user-agent") ?? "";

  // Run webhook + CAPI + DOI email in parallel; collect outcomes.
  const tasks: Promise<unknown>[] = [];

  if (fresh && webhookUrl) {
    const adapter = pickAdapter();
    tasks.push(adapter.send(payload, webhookUrl).catch(() => undefined));
  }

  // Double-opt-in: only fire if the patient actually ticked marketing.
  // The lead itself still goes to the CRM (above) with `marketingConfirmedAt: null`
  // so the receiver knows to hold off on the nurture sequence until confirmation.
  //
  // Wrapped in try/catch because a missing DOI_SIGNING_SECRET / RESEND_API_KEY
  // is a config error — it must NEVER take down the lead intake. The patient's
  // appointment request still succeeds; only the marketing nurture is gated.
  if (fresh && payload.consents.marketing) {
    try {
      const token = signDoiToken({
        e: payload.email,
        c: clinic.slug,
        t: treatment.slug,
        id: payload.meta.eventId,
      });
      const confirmUrl = `${req.nextUrl.origin}/api/lead/confirm-marketing?t=${encodeURIComponent(token)}`;
      tasks.push(
        sendDoiEmail({
          to: payload.email,
          firstName: payload.firstName,
          clinic,
          confirmUrl,
        }).catch(() => undefined),
      );
    } catch (err) {
      console.error("[lead] DOI dispatch failed (lead still accepted):", (err as Error).message);
    }
  }

  // Portal mirror — best-effort, like the CRM/CAPI tasks. The portal is the
  // long-term system of record, but a portal outage must never block the
  // patient. `sendToPortal` itself is a no-op when PORTAL_URL or the
  // per-clinic secret env var is unset.
  if (fresh) {
    tasks.push(sendToPortal(payload, clinic, treatment, process.env).catch(() => undefined));
  }

  const capiToken = envTokenForSlug(clinic.slug);
  if (fresh && clinic.connectors.metaPixelId && capiToken) {
    tasks.push(
      sendMetaCapi({
        pixelId: clinic.connectors.metaPixelId,
        accessToken: capiToken,
        events: [
          {
            event_name: "Lead",
            event_id: payload.meta.eventId,
            event_source_url: payload.meta.sourceUrl,
            user_data: {
              em: [hashEmail(payload.email)],
              ph: payload.phone ? [hashPhone(payload.phone)] : undefined,
              fn: payload.firstName ? [hashName(payload.firstName)] : undefined,
              ct: payload.city ? [hashName(payload.city)] : undefined,
              fbc: payload.meta.fbc,
              fbp: payload.meta.fbp,
              client_user_agent: ua,
              client_ip_address: ip || undefined,
            },
            custom_data: {
              treatment_slug: payload.treatmentSlug,
              clinic_slug: payload.clinicSlug,
              branch: payload.branch,
            },
          },
        ],
      }).catch(() => undefined),
    );
  }

  // Don't await failures — lead is accepted regardless.
  await Promise.allSettled(tasks);

  return NextResponse.json(
    {
      ok: true,
      eventId: payload.meta.eventId,
      idempotency: dedupKey,
      duplicate: !fresh,
    },
    { status: 200 },
  );
}
