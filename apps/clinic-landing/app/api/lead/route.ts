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
  /**
   * Honeypot — a hidden, CSS-suppressed input named `website` (or any other
   * unused field name). Real humans never fill it; bots that auto-fill
   * every visible field do. Any non-empty value silently 202s so the bot
   * thinks it worked and doesn't try a different vector.
   */
  website: z.string().max(200).optional(),
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

/**
 * Per-IP rate limit. In-memory because the clinic-landing app is
 * single-region and Redis-free; a coordinated attacker could route around
 * this with a botnet but we'd see that pattern in logs and lift to a CDN
 * rule. The point is to stop unsophisticated form spam.
 *
 * Window is sliding 10 min, capped at 20 submits per IP. Matches the
 * portal intake's `leads-intake` Redis rate limit shape.
 */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const ipBuckets = new Map<string, number[]>();

function ipRateLimitOk(ip: string): boolean {
  if (!ip) return true; // can't bucket; let dedup handle it
  const now = Date.now();
  const bucket = (ipBuckets.get(ip) ?? []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  if (bucket.length >= RATE_LIMIT_MAX) {
    ipBuckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  ipBuckets.set(ip, bucket);
  // Opportunistic GC so the Map can't grow without bound.
  if (ipBuckets.size > 5000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [k, v] of ipBuckets.entries()) {
      if (v[v.length - 1]! < cutoff) ipBuckets.delete(k);
    }
  }
  return true;
}

/**
 * Reject submissions whose Origin/Referer doesn't match the request host.
 * Real form posts always come from the same origin as the page that
 * rendered them. CSRF + scripted-spam attempts often skip these headers
 * or set them to a different host. We accept missing headers (some
 * browsers strip them in privacy modes) but reject mismatches.
 */
function originLooksLegit(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return true;
  for (const headerName of ["origin", "referer"]) {
    const v = req.headers.get(headerName);
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function POST(req: NextRequest) {
  // Origin/Referer check — runs before parsing the body so we don't even
  // burn JSON-parse cycles on obviously off-host requests. A mismatched
  // origin gets a generic 400 so we don't tell the attacker which header
  // tripped them up.
  if (!originLooksLegit(req)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 400 });
  }

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

  // Honeypot — silently 202 so the bot believes it succeeded. Don't even
  // dedup-track or rate-count the IP: this is one of the most reliable
  // ways to drop scripted spam without affecting real users.
  if (parse.data.website && parse.data.website.length > 0) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  const clinic = getClinic(payload.clinicSlug);
  const treatment = getTreatment(payload.clinicSlug, payload.treatmentSlug);
  if (!clinic || !treatment) {
    return NextResponse.json({ error: "unknown_clinic_or_treatment" }, { status: 404 });
  }

  // Per-IP rate limit. Done AFTER clinic-validation so probes for
  // nonexistent clinics burn cycles before they slot into the bucket —
  // but BEFORE any side-effectful work (CRM, CAPI, Portal, DOI mail).
  const limiterIp = clientIp(req);
  if (!ipRateLimitOk(limiterIp)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "600" } },
    );
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
  //
  // We pass the (raw) client IP and user-agent so the portal can persist
  // an anonymised IP + UA onto the requests row for the Meta CAPI
  // Purchase / Google Ads OCI workers. The IP is anonymised inside
  // `mapToIntake` before being written to JSON, so it never leaves this
  // process unredacted.
  if (fresh) {
    tasks.push(
      sendToPortal(payload, clinic, treatment, process.env, {
        clientIp: clientIp(req),
        userAgent: ua,
      }).catch(() => undefined),
    );
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
