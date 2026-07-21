import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { REQUEST_SOURCES } from "@/lib/constants";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { verifyLeadSignature, persistLead } from "@/server/leads";
import { clinicHasIntakeSecret } from "@/server/clinic-signature";
import { TREATMENT_CATEGORIES } from "@/worker/processors/treatment-tiers";

/**
 * Public lead-intake endpoint — receives form submissions from clinic
 * landing pages. Security model:
 *   1. HMAC-SHA256 signature via X-EINS-Signature (per-clinic shared secret).
 *   2. Per-clinic rate limit (60 req / 10 min) so a compromised key can't flood.
 *   3. Honeypot field "hp_field" — if present, silently drop.
 *
 * Success response is deliberately minimal and symmetric with signature
 * failure so the endpoint doesn't leak whether a clinic exists.
 */

/**
 * Structured pre-qualifier answers from the clinic-landing form. Optional
 * because manual / WhatsApp / paid-ad intake doesn't carry them. When present,
 * the worker uses these to score via deterministic rules and skips OpenAI.
 */
const QuizBody = z.object({
  treatmentSlug: z.string().max(120),
  treatmentSelection: z.string().max(120),
  /**
   * Treatment category from the landing app's clinic config. Drives the
   * value-tier in the rule-based scorer. Optional for legacy payloads.
   */
  treatmentCategory: z.enum(TREATMENT_CATEGORIES).optional(),
  treatmentValueCents: z.number().int().nonnegative().optional(),
  timeframe: z
    .enum(["asap", "this-month", "next-3-months", "later", "info-only"])
    .optional(),
  experience: z.enum(["first", "had-similar", "had-this"]).optional(),
  /** Quiz v2 investment gate (OP-level flows). */
  budget: z.enum(["ja", "unsicher", "erst-informieren"]).optional(),
  /** Quiz v2 distance step (OP-level flows). */
  distance: z.enum(["in-der-naehe", "bis-1-stunde", "weiter-entfernt"]).optional(),
  branch: z.enum(["qualified", "info-only"]),
  city: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
  hasPhone: z.boolean(),
  marketingConsent: z.boolean(),
  /**
   * Patient's explicit consent for AI-assisted scoring of the notes field.
   * Optional for backwards-compat with legacy clients; the worker treats
   * `undefined` or `false` identically — no OpenAI call, deterministic fallback only.
   */
  aiProcessingConsent: z.boolean().optional(),
  eventId: z.string().max(200),
  sourceUrl: z.string().max(500).optional(),
  fbc: z.string().max(200).optional(),
  fbp: z.string().max(200).optional(),
});

/**
 * `source` aliases — accepted on input, normalised to a canonical enum
 * value before validation. The canonical set is in lib/constants.ts;
 * external producers (n8n recipes, partner integrations) occasionally use
 * the verbose names that appear in the docs ("landing_form" rather than
 * the German "formular"). Rejecting the request because of naming drift
 * has no upside, so we accept the alias and translate.
 */
const SOURCE_ALIASES: Record<string, (typeof REQUEST_SOURCES)[number]> = {
  landing_form: "formular",
  landingForm: "formular",
  meta_lead_ads: "meta",
  google_ads: "google",
  manual: "manuell",
};

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
  fbclid: z.string().max(256).optional(),
  gclid: z.string().max(256).optional(),
  wbraid: z.string().max(256).optional(),
  gbraid: z.string().max(256).optional(),
  fbc: z.string().max(256).optional(),
  fbp: z.string().max(256).optional(),
  clickIpAnon: z.string().max(64).optional(),
  clickUserAgent: z.string().max(500).optional(),
});

const Body = z.object({
  clinicId: z.string().uuid(),
  source: z
    .string()
    .transform((s) => SOURCE_ALIASES[s] ?? s)
    .pipe(z.enum(REQUEST_SOURCES)),
  sourceCampaignId: z.string().max(200).optional(),
  sourceAdId: z.string().max(200).optional(),
  utm: z.record(z.string(), z.string()).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().max(64).optional(),
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
  budgetIndication: z.string().max(200).optional(),
  message: z.string().max(5000).optional(),
  dsgvoConsent: z.boolean(),
  quiz: QuizBody.optional(),
  attribution: AttributionBody.optional(),
  hp_field: z.string().optional(), // honeypot
});

export async function POST(request: NextRequest) {
  // Strict content-type. A producer that sends `text/plain` with a JSON
  // body is signaling a bug in its own serializer or a probe; refuse so
  // we don't store payloads under the wrong assumed schema. Symmetric
  // failure shape with the parse path so it doesn't leak info to probes.
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return genericFail();
  }

  const raw = await request.text();
  const sig = request.headers.get("x-eins-signature");

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    // Symmetric response on any parse failure — don't help a probe.
    return genericFail();
  }

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

  // Per-IP-first gate (pentest M6): a known clinicId must not be sprayable to
  // exhaust a clinic's bucket with unsigned junk before signature check.
  const ipForGate =
    (request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      "")
      .split(",")[0]
      ?.trim() || null;
  if (ipForGate) {
    const ipRl = await rateLimit("leads-intake-ip", ipForGate, {
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

  // Rate-limit by clinic — we must be careful not to leak timing here, but
  // symmetrically dropping counts as "slow down".
  const rl = await rateLimit("leads-intake", parsed.clinicId, {
    limit: 60,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited" } },
      {
        status: 429,
        headers: { "Retry-After": String(rl.resetInSeconds) },
      }
    );
  }

  // Capture caller IP for DSGVO proof AND for deferred audit metadata.
  const ipRaw = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  const ip = ipRaw.split(",")[0]?.trim() || null;
  const requestMeta = { ip, ua: request.headers.get("user-agent") ?? null };

  // Signature verification.
  const ok = await verifyLeadSignature(parsed.clinicId, raw, sig);
  if (!ok) {
    // Distinguish "bad signature against a real clinic" from "request
    // targeted a clinic that doesn't exist (or hasn't generated an intake
    // secret yet)". They're operationally very different — a bad_signature
    // burst is a leaked-secret incident; a forged_clinic burst is a probe
    // for tenancy enumeration. Both still 400 with the same body so the
    // attacker can't tell.
    const reason = (await clinicHasIntakeSecret(parsed.clinicId))
      ? "bad_signature"
      : "forged_clinic";
    // Synchronous audit (not after()) — Round 2 testing observed
    // audit-row > request-row drift on this path, plausibly because
    // after() callbacks ran for retries Vercel later cancelled. Cost is
    // one small INSERT before the 400; not worth optimizing.
    await writeAudit({
      clinicId: parsed.clinicId,
      action: "lead_intake_reject",
      entityKind: "request",
      diff: { reason },
      requestMeta,
    });
    return genericFail();
  }

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
      clickUserAgent:
        parsed.attribution?.clickUserAgent ?? requestMeta.ua ?? null,
      clickIpAnon: parsed.attribution?.clickIpAnon ?? null,
    };

    const result = await persistLead(parsed.clinicId, {
      source: parsed.source,
      sourceCampaignId: parsed.sourceCampaignId ?? null,
      sourceAdId: parsed.sourceAdId ?? null,
      utm: parsed.utm ?? null,
      contactName: parsed.contactName ?? null,
      contactEmail: parsed.contactEmail ?? null,
      contactPhone: parsed.contactPhone ?? null,
      treatmentWish: parsed.treatmentWish ?? null,
      budgetIndication: parsed.budgetIndication ?? null,
      message: parsed.message ?? null,
      dsgvoConsent: true,
      dsgvoConsentIp: ip,
      rawPayload: JSON.parse(raw),
      quiz: parsed.quiz ?? null,
      intakeIdempotencyKey: idempotencyKey.length > 0 ? idempotencyKey : null,
      attribution,
    });
    const id = result.id;

    // Audit synchronously so the audit row commits in the same request
    // lifecycle as the inserted request — the after()-based version of
    // this code drifted in Round 2 testing (more audits than requests).
    await writeAudit({
      clinicId: parsed.clinicId,
      action: "lead_intake",
      entityKind: "request",
      entityId: id,
      diff: { source: parsed.source, status: result.status },
      requestMeta,
    });

    // Note: the worker picks up AI-scoring jobs via a polling tick;
    // the enqueue is best-effort from a route on the portal so a broken
    // queue doesn't reject the lead. Skipped on dedupe — re-scoring an
    // existing lead is wasted work.
    if (result.status === "inserted") {
      try {
        const { enqueueAiScore } = await import("@/server/jobs");
        await enqueueAiScore(id);
      } catch (err) {
        console.warn("[leads] ai-score enqueue failed:", err);
      }
    }

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    console.error("[leads] persist failed:", err);
    return NextResponse.json(
      { error: { code: "internal" } },
      { status: 500 }
    );
  }
}

function genericFail(): NextResponse {
  // Same shape as validation failure — caller can't distinguish.
  return NextResponse.json(
    { error: { code: "invalid_request" } },
    { status: 400 }
  );
}
