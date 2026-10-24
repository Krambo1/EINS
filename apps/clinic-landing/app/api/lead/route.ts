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
import { paidAdPlatformOfVisit } from "@/lib/paid-ad-platform";
import { sendToPortal, type PortalRelayResult } from "@/lib/portal-intake";
import type { QuizSubmissionPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The portal relay retries (3 x 6 s timeout + backoff) before giving up.
export const maxDuration = 30;

/**
 * Lead intake.
 *
 * 1. Validate payload server-side (zod)
 * 2. Compute idempotency hash; drop duplicates the portal already accepted
 * 3. Relay to the EINS portal (system of record) with retries. If the portal
 *    does not accept, answer 502 so the form shows an error with the Praxis
 *    phone number. The patient never sees success for a lost inquiry.
 * 4. Then, best-effort: CRM webhook, DOI email, Meta CAPI (deduped via event_id)
 * 5. Return { ok: true, eventId }
 */

const submissionSchema = z.object({
  clinicSlug: z.string().regex(/^[a-z0-9-_]+$/),
  treatmentSlug: z.string().regex(/^[a-z0-9-]+$/),
  branch: z.enum(["qualified", "info-only"]),
  treatment: z.string().min(1),
  timeframe: z.string().optional(),
  experience: z.string().optional(),
  city: z.string().max(80).optional(),
  budget: z.enum(["ja", "unsicher", "erst-informieren"]).optional(),
  distance: z.enum(["in-der-naehe", "bis-1-stunde", "weiter-entfernt"]).optional(),
  firstName: z.string().min(1).max(60).optional(),
  email: z.string().email().max(120),
  phone: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  // Optional self-report. Loose here on purpose: an unknown value is dropped
  // in lib/portal-intake.ts, it never costs the inquiry.
  selfReportedSource: z
    .unknown()
    .transform((v) => (typeof v === "string" && v.length <= 40 ? v : undefined))
    .optional(),
  consents: z.object({
    privacy: z.literal(true, {
      errorMap: () => ({ message: "consents.privacy must be true" }),
    }),
    ageGate: z.literal(true, {
      errorMap: () => ({ message: "consents.ageGate must be true" }),
    }),
    marketing: z.boolean(),
    aiProcessing: z.boolean(),
    /**
     * Separate, optional consent to report the inquiry and a later treatment
     * to Meta and Google (lib/ads-consent.ts). Optional with default false so
     * older clients keep working and count as "no consent".
     */
    adsMeasurement: z.boolean().optional().default(false),
    adsMeasurementVersion: z.string().max(40).optional(),
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

/** True when this instance already delivered the same inquiry recently. */
function seenRecently(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of SEEN_KEYS.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) SEEN_KEYS.delete(k);
  }
  return SEEN_KEYS.has(key);
}

/**
 * Reserve the key only AFTER the portal accepted (or the clinic has no
 * portal mirror). A failed relay must leave the patient free to resend.
 */
function rememberKey(key: string): void {
  SEEN_KEYS.set(key, Date.now());
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function clientIp(req: NextRequest): string {
  // x-real-ip is set by Vercel and cannot be spoofed; the leftmost
  // x-forwarded-for entry can. Fall back to XFF only without x-real-ip.
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "";
}

/**
 * Per-IP rate limit. In-memory because the clinic-landing app is
 * single-region and Redis-free; a coordinated attacker could route around
 * this with a botnet but we'd see that pattern in logs and lift to a CDN
 * rule. The point is to stop unsophisticated form spam.
 *
 * Window is sliding 10 min, capped at 20 submits per IP. Matches the
 * portal intake's `leads-intake` Redis rate limit shape.
 *
 * Pentest M16 — KNOWN LIMITATION: on Vercel each lambda instance has its own
 * Map, so this bucket (and `SEEN_KEYS` dedup below) only bind a single warm
 * instance. Under fan-out they do NOT enforce a global cap. The durable
 * backstops are: (a) the portal `/api/leads/intake` endpoint, which the
 * system-of-record `sendToPortal` call hits — it has the per-IP + per-clinic
 * Postgres rate limiter (pentest M6); and (b) the CDN/WAF rule the comment
 * above references. A truly global in-app limit needs a shared KV (Vercel
 * KV / Upstash) — an infra provisioning decision tracked as an owner action.
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
  const fresh = !seenRecently(dedupKey);

  const ua = payload.meta.ua ?? req.headers.get("user-agent") ?? "";

  // Portal first: it is the system of record. Only when it accepted (or the
  // clinic has no portal mirror) do the side effects below run, so a failed
  // relay never sends a DOI mail or a Meta Lead for an inquiry the patient
  // was told did not go through.
  if (fresh) {
    const relay = await sendToPortal(payload, clinic, treatment, process.env, {
      clientIp: clientIp(req),
      userAgent: ua,
    }).catch(
      (): PortalRelayResult => ({ status: "failed", reason: "exception", attempts: 0 }),
    );
    if (relay.status === "failed") {
      // No patient data in the log line: clinic slug + reason only.
      console.error(
        `[lead] portal relay failed clinic=${clinic.slug} reason=${relay.reason} attempts=${relay.attempts}`,
      );
      return NextResponse.json(
        {
          error: `Ihre Anfrage konnte gerade nicht übermittelt werden. Bitte versuchen Sie es in einer Minute noch einmal oder rufen Sie uns an: ${clinic.contact.phoneDisplay}`,
        },
        { status: 502 },
      );
    }
    rememberKey(dedupKey);
  }

  const webhookUrl = webhookUrlForClinic(clinic.slug, clinic.connectors.webhookUrl);
  const ip = anonymizeIp(clientIp(req));

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

  const capiToken = envTokenForSlug(clinic.slug);
  // Lead goes to Meta ONLY for the qualified branch (info-only requests
  // would teach the pixel to optimize on low-intent traffic), ONLY with the
  // person's separate ads consent, and ONLY when a paid Meta ad brought the
  // visit (owner decision 2026-10-06; fbclid alone does not count).
  const reportToMeta =
    payload.consents.adsMeasurement === true &&
    paidAdPlatformOfVisit(payload.meta.utm) === "meta";
  if (
    fresh &&
    payload.branch === "qualified" &&
    reportToMeta &&
    clinic.connectors.metaPixelId &&
    capiToken
  ) {
    tasks.push(
      sendMetaCapi({
        pixelId: clinic.connectors.metaPixelId,
        accessToken: capiToken,
        events: [
          {
            event_name: "Lead",
            event_id: payload.meta.eventId,
            // Origin only: the page path names the treatment.
            event_source_url: originOf(payload.meta.sourceUrl),
            user_data: {
              em: [hashEmail(payload.email)],
              ph: payload.phone ? [hashPhone(payload.phone)] : undefined,
              fn: payload.firstName ? [hashName(payload.firstName)] : undefined,
              fbc: payload.meta.fbc,
              fbp: payload.meta.fbp,
              client_user_agent: ua,
              client_ip_address: ip || undefined,
            },
            // No custom_data: Meta learns only that a paid-ad visitor inquired.
          },
        ],
      }).catch(() => undefined),
    );
  }

  // Side effects are best-effort; the portal already holds the inquiry.
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
