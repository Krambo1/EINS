import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { describeErrorForLog } from "@/lib/error-log";
import {
  INTAKE_SOURCES,
  classifyAttribution,
  parseEntrySource,
  parseSelfReportedSource,
} from "@/lib/sources";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  verifyLeadSignature,
  persistLead,
  ClinicArchivedError,
  buildLandingConsents,
  consentTimeOrNow,
} from "@/server/leads";
import { clinicHasIntakeSecret } from "@/server/clinic-signature";
import { TREATMENT_CATEGORIES } from "@/worker/processors/treatment-tiers";

/**
 * Public lead-intake endpoint — receives form submissions from clinic
 * landing pages. Security model:
 *   1. Body size cap (64 KB) and a per-IP limit on the trusted client IP,
 *      both before any parsing or database work.
 *   2. HMAC-SHA256 signature via X-EINS-Signature (per-clinic shared secret).
 *   3. Per-clinic rate limit, counted only for SIGNED requests, so an
 *      unauthenticated caller who knows a clinicId cannot exhaust it (B-17).
 *   4. Honeypot field "hp_field" — if present, silently drop.
 *
 * Robustness: optional free-form fields are truncated, unknown optional enum
 * values dropped, never the whole inquiry rejected (C-3). The original body
 * stays in raw_payload.
 *
 * Success response is deliberately minimal and symmetric with signature
 * failure so the endpoint doesn't leak whether a clinic exists.
 */

/**
 * Structured pre-qualifier answers from the clinic-landing form. Optional
 * because manual / WhatsApp / paid-ad intake doesn't carry them. When present,
 * the worker uses these to score via deterministic rules and skips OpenAI.
 */
/** Accept any length, keep the first `max` chars. */
const capped = (max: number) => z.string().transform((s) => s.slice(0, max));

const QuizBody = z.object({
  treatmentSlug: capped(120),
  treatmentSelection: capped(120),
  /**
   * Treatment category from the landing app's clinic config. Drives the
   * value-tier in the rule-based scorer. Optional for legacy payloads.
   */
  // Optional enums: an unknown value (landing ahead of the portal) is
  // dropped instead of rejecting the inquiry.
  treatmentCategory: z.enum(TREATMENT_CATEGORIES).optional().catch(undefined),
  treatmentValueCents: z.number().int().nonnegative().optional().catch(undefined),
  timeframe: z
    .enum(["asap", "this-month", "next-3-months", "later", "info-only"])
    .optional()
    .catch(undefined),
  experience: z.enum(["first", "had-similar", "had-this"]).optional().catch(undefined),
  /** Quiz v2 investment gate (OP-level flows). */
  budget: z.enum(["ja", "unsicher", "erst-informieren"]).optional().catch(undefined),
  /** Quiz v2 distance step (OP-level flows). */
  distance: z
    .enum(["in-der-naehe", "bis-1-stunde", "weiter-entfernt"])
    .optional()
    .catch(undefined),
  branch: z.enum(["qualified", "info-only"]).catch("qualified"),
  city: capped(80).optional(),
  notes: capped(1000).optional(),
  hasPhone: z.boolean(),
  marketingConsent: z.boolean(),
  /**
   * Patient's explicit consent for AI-assisted scoring of the notes field.
   * Optional for backwards-compat with legacy clients; the worker treats
   * `undefined` or `false` identically — no OpenAI call, deterministic fallback only.
   */
  aiProcessingConsent: z.boolean().optional(),
  eventId: capped(200),
  sourceUrl: capped(500).optional(),
  fbc: capped(200).optional(),
  fbp: capped(200).optional(),
});

/**
 * `source`: one of INTAKE_SOURCES or a known alias (lib/sources.ts), e.g.
 * "landing_form" for "formular". Unknown values are rejected, and so are
 * "anruf" / "buchung": only the Messweg webhooks write those.
 */

/**
 * Closed-loop attribution envelope, sent by clinic-landing's
 * `portal-intake.mapToIntake()`. Persisted onto the requests row so the
 * capi-purchase / oci-purchase workers can join InvoicePaid events back
 * to the original click. All fields optional — most rows have nothing.
 *
 * IP is already anonymised by the sender (last octet / 4 hextets zeroed);
 * never accept a raw IP here. We cap each string at 256 chars: longer
 * values are guaranteed-malformed for click IDs and would only bloat the
 * row + indexes.
 */
const AttributionBody = z.object({
  fbclid: capped(256).optional(),
  gclid: capped(256).optional(),
  wbraid: capped(256).optional(),
  gbraid: capped(256).optional(),
  fbc: capped(256).optional(),
  fbp: capped(256).optional(),
  /** TikTok click id; stored for attribution only, never reported to TikTok. */
  ttclid: capped(256).optional(),
  clickIpAnon: capped(64).optional(),
  clickUserAgent: capped(500).optional(),
});

const Body = z.object({
  clinicId: z.string().uuid(),
  source: z
    .string()
    .transform((s) => parseEntrySource(s) ?? s)
    .pipe(z.enum(INTAKE_SOURCES)),
  /**
   * Answer to "Wie sind Sie auf uns aufmerksam geworden?" (closed list).
   * An unknown value is dropped, never the inquiry. Never changes `source`
   * or the Messweg.
   */
  selfReportedSource: z
    .unknown()
    .transform((v) => parseSelfReportedSource(v) ?? undefined)
    .optional(),
  sourceCampaignId: capped(200).optional(),
  sourceAdId: capped(200).optional(),
  utm: z
    .record(z.string(), z.string())
    .transform((rec) =>
      Object.fromEntries(
        Object.entries(rec)
          .slice(0, 30)
          .map(([k, v]) => [k.slice(0, 100), v.slice(0, 500)])
      )
    )
    .optional(),
  contactName: capped(200).optional(),
  // An address the validator dislikes is dropped (raw_payload keeps it);
  // the inquiry itself still lands.
  contactEmail: z.string().trim().email().max(254).optional().catch(undefined),
  contactPhone: capped(64).optional(),
  // Landing accepts up to 1000 chars on `notes` (which maps to message)
  // but `treatmentWish` is a separate, shorter selector field. Keep the
  // 500-char cap but transform rather than reject: a longer string just
  // gets truncated server-side, with the full value preserved in
  // raw_payload for audit. Round 2 testing flagged the silent payload drift.
  treatmentWish: z
    .string()
    .max(2000)
    .transform((s) => s.slice(0, 500))
    .optional(),
  budgetIndication: capped(200).optional(),
  message: capped(5000).optional(),
  dsgvoConsent: z.boolean(),
  /**
   * Patient IP for the consent record, sent by the landing server (the
   * request's own IP is that server's egress, not the patient). Stored only
   * when it parses as an IP; anything else becomes NULL (C-11).
   */
  consentIp: z.string().max(64).optional(),
  quiz: QuizBody.optional(),
  attribution: AttributionBody.optional(),
  /**
   * Separate, optional consent from the clinic-landing form to report this
   * inquiry and a later treatment to Meta and Google (migration 0077).
   * Absent = no consent (older landing clients, every other producer).
   */
  adsConsent: z.boolean().optional(),
  adsConsentVersion: capped(40).optional(),
  /**
   * Consent record from clinic-landing (L-6): versions of the texts the
   * person saw and the landing's submit time. Optional (older landings);
   * a malformed record is dropped, never the inquiry.
   */
  consentRecord: z
    .object({
      privacyVersion: capped(40).optional(),
      ageGate: z.boolean().optional(),
      aiVersion: capped(40).optional(),
      marketingVersion: capped(40).optional(),
      at: z.string().datetime({ offset: true }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  hp_field: z.string().optional(), // honeypot
});

export const runtime = "nodejs";
// The response is fast; after() then runs the inline AI score (up to 20 s,
// K-5), the PVS token write and the "Neue Anfrage" mail in the same budget.
export const maxDuration = 60;

/** Real form payloads are a few KB; anything larger is not a lead. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  // Strict content-type. A producer that sends `text/plain` with a JSON
  // body is signaling a bug in its own serializer or a probe; refuse so
  // we don't store payloads under the wrong assumed schema. Symmetric
  // failure shape with the parse path so it doesn't leak info to probes.
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return genericFail();
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return genericFail();

  // Per-IP gate on the TRUSTED client IP (x-real-ip / rightmost XFF), before
  // any parsing: the leftmost XFF entry is client-controlled (I-9).
  const callerIp = trustedIpFromHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip")
  );
  if (callerIp) {
    const ipRl = await rateLimit("leads-intake-ip", callerIp, {
      limit: 600,
      windowSeconds: 600,
    });
    if (!ipRl.ok) {
      return NextResponse.json(
        { error: { code: "rate_limited" } },
        { status: 429, headers: { "Retry-After": String(ipRl.resetInSeconds) } }
      );
    }
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return genericFail();
  const sig = request.headers.get("x-eins-signature");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return genericFail();
  }
  const result = Body.safeParse(json);
  if (!result.success) {
    // Field paths only, never values: tells us which field a producer got
    // wrong without logging patient data.
    console.warn(
      "[leads] intake rejected, invalid fields:",
      result.error.issues
        .map((i) => i.path.join(".") || "(root)")
        .slice(0, 10)
        .join(", ")
    );
    // Symmetric response on any parse failure — don't help a probe.
    return genericFail();
  }
  const parsed = result.data;

  // Honeypot tripped → pretend success, log nothing interesting.
  if (parsed.hp_field && parsed.hp_field.length > 0) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  if (!parsed.dsgvoConsent) {
    return NextResponse.json(
      { error: { code: "dsgvo_required", message: "DSGVO-Zustimmung erforderlich." } },
      { status: 400 }
    );
  }

  const requestMeta = { ip: callerIp, ua: request.headers.get("user-agent") ?? null };

  // Signature verification BEFORE the per-clinic bucket (B-17).
  const ok = await verifyLeadSignature(parsed.clinicId, raw, sig);
  if (!ok) {
    // Distinguish "bad signature against a real clinic" from "request
    // targeted a clinic that doesn't exist (or hasn't generated an intake
    // secret yet)". They're operationally very different — a bad_signature
    // burst is a leaked-secret incident; a forged_clinic burst is a probe
    // for tenancy enumeration. Both still 400 with the same body so the
    // attacker can't tell.
    //
    // Audit rows are throttled per clinic (20 per 10 min): enough to see an
    // incident, not enough for unsigned junk to bloat audit_log. Burning
    // this bucket only silences audits, never real inquiries.
    const auditRl = await rateLimit("leads-intake-reject-audit", parsed.clinicId, {
      limit: 20,
      windowSeconds: 600,
    });
    if (auditRl.ok) {
      const reason = (await clinicHasIntakeSecret(parsed.clinicId))
        ? "bad_signature"
        : "forged_clinic";
      // Synchronous audit (not after()) — Round 2 testing observed
      // audit-row > request-row drift on this path, plausibly because
      // after() callbacks ran for retries Vercel later cancelled.
      await writeAudit({
        clinicId: parsed.clinicId,
        action: "lead_intake_reject",
        entityKind: "request",
        diff: { reason },
        requestMeta,
      });
    }
    return genericFail();
  }

  // Per-clinic limit, signed requests only: bounds a leaked key without
  // letting anyone else block the clinic. 200 / 10 min is far above a real
  // ad day; the landing shows the patient an error + phone number on 429.
  const rl = await rateLimit("leads-intake", parsed.clinicId, {
    limit: 200,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    console.warn(`[leads] clinic rate limit hit clinic=${parsed.clinicId}`);
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      {
        status: 429,
        headers: { "Retry-After": String(rl.resetInSeconds) },
      }
    );
  }

  // Patient IP for the consent record comes from the landing body, never
  // from this request (that is the landing server's egress IP). Invalid
  // strings become NULL instead of failing the inet insert (C-11).
  const consentIpRaw = parsed.consentIp?.trim() ?? "";
  const consentIp = consentIpRaw && isIP(consentIpRaw) !== 0 ? consentIpRaw : null;

  // Optional client-supplied idempotency key. The shape is opaque — we
  // never inspect the key contents. Trimmed + capped at 200 chars to
  // avoid arbitrarily-long b-tree entries from a hostile client.
  const idempotencyKey = (request.headers.get("idempotency-key") ?? "")
    .trim()
    .slice(0, 200);

  try {
    // Click-ID + browser-hint envelope from the clinic-landing sender,
    // falling back to the legacy quiz.fbc/fbp for older landings that
    // predate the `attribution` field. Browser hints (UA, anonymised IP)
    // fall back to the request-level values when the sender didn't pass
    // them, so older landings still produce CAPI-viable user_data.
    const attribution = {
      fbclid: parsed.attribution?.fbclid ?? null,
      gclid: parsed.attribution?.gclid ?? null,
      wbraid: parsed.attribution?.wbraid ?? null,
      gbraid: parsed.attribution?.gbraid ?? null,
      fbc: parsed.attribution?.fbc ?? parsed.quiz?.fbc ?? null,
      fbp: parsed.attribution?.fbp ?? parsed.quiz?.fbp ?? null,
      ttclid: parsed.attribution?.ttclid ?? null,
      clickUserAgent:
        parsed.attribution?.clickUserAgent ?? requestMeta.ua?.slice(0, 500) ?? null,
      clickIpAnon: parsed.attribution?.clickIpAnon ?? null,
    };

    // persistLead schedules AI score, PVS token write and the "Neue
    // Anfrage" email itself (after the response), for every producer.
    const persisted = await persistLead(parsed.clinicId, {
      source: parsed.source,
      sourceCampaignId: parsed.sourceCampaignId ?? null,
      sourceAdId: parsed.sourceAdId ?? null,
      utm: parsed.utm ?? null,
      selfReportedSource: parsed.selfReportedSource ?? null,
      contactName: parsed.contactName ?? null,
      contactEmail: parsed.contactEmail ?? null,
      contactPhone: parsed.contactPhone ?? null,
      treatmentWish: parsed.treatmentWish ?? null,
      budgetIndication: parsed.budgetIndication ?? null,
      message: parsed.message ?? null,
      dsgvoConsent: true,
      dsgvoConsentIp: consentIp,
      rawPayload: json,
      quiz: parsed.quiz ?? null,
      intakeIdempotencyKey: idempotencyKey.length > 0 ? idempotencyKey : null,
      attribution,
      // Only the EINS form shows the consent checkbox; any other producer
      // claiming it is ignored.
      adsConsent:
        parsed.adsConsent === true &&
        classifyAttribution({ source: parsed.source, utm: null }).messweg === "formular",
      adsConsentVersion: parsed.adsConsentVersion ?? null,
      // Consent record (L-6). Only the landing form sends versions; other
      // producers still get the basis and the booleans they sent.
      ...consentFields(parsed),
    });
    const id = persisted.id;

    // Audit synchronously so the audit row commits in the same request
    // lifecycle as the inserted request — the after()-based version of
    // this code drifted in Round 2 testing (more audits than requests).
    await writeAudit({
      clinicId: parsed.clinicId,
      action: "lead_intake",
      entityKind: "request",
      entityId: id,
      diff: { source: parsed.source, status: persisted.status },
      requestMeta,
    });

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    if (err instanceof ClinicArchivedError) {
      // Signed caller, so no enumeration concern. The landing shows the
      // patient an error with the phone number instead of a false success.
      console.warn(`[leads] intake for archived clinic=${parsed.clinicId}`);
      return NextResponse.json({ error: { code: "clinic_archived" } }, { status: 409 });
    }
    console.error("[leads] persist failed:", JSON.stringify(describeErrorForLog(err)));
    return NextResponse.json({ error: { code: "internal" } }, { status: 500 });
  }
}

function consentFields(parsed: z.infer<typeof Body>) {
  const rec = parsed.consentRecord;
  // L-6: same window as dsgvo_consent_at (persistLead clamps both again).
  const at = consentTimeOrNow(rec?.at ? new Date(rec.at) : null);
  if (!rec && !parsed.quiz) return { consents: null, consentAt: null };
  return {
    consentAt: rec?.at ? at : null,
    consents: buildLandingConsents({
      at,
      privacyVersion: rec?.privacyVersion ?? null,
      ageGate: rec?.ageGate,
      aiGiven: parsed.quiz?.aiProcessingConsent === true,
      aiVersion: rec?.aiVersion ?? null,
      marketingGiven: parsed.quiz?.marketingConsent === true,
      marketingVersion: rec?.marketingVersion ?? null,
    }),
  };
}

function genericFail(): NextResponse {
  // Same shape as validation failure — caller can't distinguish.
  return NextResponse.json(
    { error: { code: "invalid_request" } },
    { status: 400 }
  );
}
