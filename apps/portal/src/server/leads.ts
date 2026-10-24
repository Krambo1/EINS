import "server-only";
import { after } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { describeErrorForLog } from "@/lib/error-log";
import { SLA_HOURS } from "@/lib/constants";
import {
  attributionConfidence,
  parseSelfReportedSource,
  type EntrySource,
  type SelfReportedSource,
} from "@/lib/sources";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { PHONE_MATCH_DIGITS, phoneKey } from "@/server/request-patient-link";
import { postCodeFromUtm } from "@/lib/post-code";
import { enqueueAiScore, enqueuePvsLeadTokenWrite } from "@/server/jobs";
import { scheduleNewRequestNotification } from "@/server/request-notify";

/**
 * Verify an HMAC-signed lead payload. Thin wrapper around the shared
 * `verifyClinicSignature` helper — both /api/leads/intake and
 * /api/patients/events share the same per-clinic 'intake' secret.
 */
export async function verifyLeadSignature(
  clinicId: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  return verifyClinicSignature(clinicId, rawBody, signatureHeader, "leads");
}

/**
 * Structured pre-qualifier signals from the clinic-landing form. Persisted into
 * `requests.ai_signals` and consumed by the rule-based scorer in the worker.
 * Mirrors the shape of the intake route's `quiz` Zod schema — kept loose here
 * so server code doesn't import from the route module.
 */
export interface LeadQuiz {
  treatmentSlug: string;
  treatmentSelection: string;
  /**
   * Category of the originating treatment (e.g. "rhino", "botox"). Mirrors the
   * `TreatmentCategory` enum in apps/clinic-landing/lib/types.ts. Optional for
   * backwards-compatibility with legacy payloads — the scorer falls back to a
   * neutral tier when missing.
   */
  treatmentCategory?: string;
  /** Floor of the treatment's `priceRange.fromCents`. Currently unused by the scorer but persisted for future tuning. */
  treatmentValueCents?: number;
  timeframe?: "asap" | "this-month" | "next-3-months" | "later" | "info-only";
  experience?: "first" | "had-similar" | "had-this";
  branch: "qualified" | "info-only";
  city?: string;
  notes?: string;
  hasPhone: boolean;
  marketingConsent: boolean;
  /**
   * Explicit DSGVO consent for AI-assisted scoring of `notes` via OpenAI.
   * Optional for backwards-compat — when undefined or false, the ai-score
   * worker MUST skip the OpenAI call and use the deterministic fallback.
   * See Art. 9 + Art. 22 + Art. 49 DSGVO.
   */
  aiProcessingConsent?: boolean;
  eventId: string;
  sourceUrl?: string;
  fbc?: string;
  fbp?: string;
}

/**
 * Closed-loop attribution envelope — click-IDs + browser hints captured at
 * lead time and persisted on the requests row so the capi-purchase /
 * oci-purchase workers can join InvoicePaid events back to the original
 * paid click. All fields nullable: organic / manual / PVS-only requests
 * will not have them.
 */
export interface LeadAttribution {
  fbclid: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  fbc: string | null;
  fbp: string | null;
  /** TikTok click id. Stored for attribution only; nothing is reported to TikTok. */
  ttclid?: string | null;
  clickUserAgent: string | null;
  /** Anonymised IP (last octet / 4 hextets zeroed). Never the raw IP. */
  clickIpAnon: string | null;
}

export interface LeadInput {
  source: EntrySource;
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
  utm?: Record<string, string> | null;
  /**
   * "Wie sind Sie auf uns aufmerksam geworden?" (closed list). Goes into the
   * Auswertung only; never changes `source`, the Messweg or the guarantee.
   */
  selfReportedSource?: SelfReportedSource | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  treatmentWish?: string | null;
  budgetIndication?: string | null;
  message?: string | null;
  dsgvoConsent: boolean;
  dsgvoConsentIp?: string | null;
  rawPayload?: unknown;
  /** Structured form answers, persisted to `ai_signals.quiz`. */
  quiz?: LeadQuiz | null;
  /**
   * Meta's canonical leadgen id. Set by the /api/webhooks/meta/leadgen
   * route; the unique partial index (clinic_id, meta_lead_id) makes a
   * retry from Meta dedupe at the DB.
   */
  metaLeadId?: string | null;
  /**
   * Client-supplied idempotency key from the `Idempotency-Key` HTTP
   * header on /api/leads/intake. Unique-per-clinic (partial index in
   * migration 0034) so flaky-network double-submits collapse into one row.
   */
  intakeIdempotencyKey?: string | null;
  /**
   * Optional click-ID envelope, persisted onto the requests row.
   * Missing on legacy callers (Meta leadgen webhook, manual UI entry);
   * present on landing-form submits via clinic-landing/portal-intake.
   */
  attribution?: LeadAttribution | null;
  /**
   * Separate, optional consent to report this inquiry and a later treatment
   * to Meta and Google (migration 0077). Only the clinic-landing form sends
   * it; every other producer (Meta Lead Gen webhook, manual entry, imports)
   * leaves it unset, so those requests are never reported.
   */
  adsConsent?: boolean;
  /** Version of the consent text the person saw. Stored only with consent. */
  adsConsentVersion?: string | null;
  /**
   * Messweg webhooks and the front-desk entry: when an Anfrage of the same
   * Praxis with the same e-mail or phone (last 9 digits) arrived within this
   * many days, nothing new is created; `sameContactActivity` is added to that
   * Anfrage instead ("dieselbe Person ein zweites Mal innerhalb von 30 Tagen"
   * counts once, KANON § 5). Spam-marked Anfragen are ignored.
   */
  sameContactWithinDays?: number | null;
  sameContactActivity?: {
    body: string;
    meta: Record<string, unknown>;
    /** 'messweg' (webhooks, default) or 'note' (front desk: not a Messweg, not a contact attempt). */
    kind?: "messweg" | "note";
  } | null;
  /** EINS tracking number of an 'anruf' (0098). */
  trackingNumberId?: string | null;
  /** EINS booking link of a 'buchung' (0098). */
  bookingLinkId?: string | null;
  /** Booked appointment time ('buchung'): the Anfrage starts as "Termin vereinbart". */
  appointmentAt?: Date | null;
  /**
   * Consent record persisted to `requests.consents` (L-6): basis, text
   * versions and times. Built by the producer (intake route, Meta webhook);
   * see `buildLandingConsents` / `buildMetaConsents`.
   */
  consents?: LeadConsents | null;
  /**
   * When the person gave the DSGVO consent, if the producer knows it (landing
   * submit time, Meta form time). Accepted only within a sane window around
   * arrival (`consentTimeOrNow`); otherwise the arrival time is stored.
   */
  consentAt?: Date | null;
}

export interface LeadConsents {
  basis: "landing_form" | "meta_leadform";
  privacy?: { version: string | null; at: string };
  ageGate?: { given: boolean; at: string };
  ai?: { given: boolean; version: string | null; at: string };
  marketing?: { given: boolean; version: string | null; at: string; pending: "doi" | null };
  metaFormId?: string | null;
}

/** Landing form consents as sent by clinic-landing `portal-intake.ts`. */
export function buildLandingConsents(input: {
  at: Date;
  privacyVersion?: string | null;
  ageGate?: boolean;
  aiGiven: boolean;
  aiVersion?: string | null;
  marketingGiven: boolean;
  marketingVersion?: string | null;
}): LeadConsents {
  const at = input.at.toISOString();
  return {
    basis: "landing_form",
    privacy: { version: input.privacyVersion ?? null, at },
    ageGate: { given: input.ageGate === true, at },
    ai: { given: input.aiGiven, version: input.aiGiven ? input.aiVersion ?? null : null, at },
    // Marketing mails need the double opt-in; the form only records the wish.
    marketing: {
      given: input.marketingGiven,
      version: input.marketingGiven ? input.marketingVersion ?? null : null,
      at,
      pending: input.marketingGiven ? "doi" : null,
    },
  };
}

/** Meta Lead Ad: the consent text is Meta's form; the form id identifies it. */
export function buildMetaConsents(input: { at: Date; formId: string | null }): LeadConsents {
  return {
    basis: "meta_leadform",
    privacy: { version: input.formId ? `meta-form:${input.formId}` : null, at: input.at.toISOString() },
    metaFormId: input.formId,
  };
}

/**
 * Producer-supplied consent time if it lies between 7 days before and 5
 * minutes after arrival (Meta redelivers for days), else arrival time.
 */
export function consentTimeOrNow(candidate: Date | null | undefined, now: Date = new Date()): Date {
  if (!candidate || Number.isNaN(candidate.getTime())) return now;
  const t = candidate.getTime();
  if (t > now.getTime() + 5 * 60_000) return now;
  if (t < now.getTime() - 7 * 24 * 3600_000) return now;
  return candidate;
}

/**
 * L-6: every `consents.<kind>.at` gets the same window as dsgvo_consent_at
 * (`consentTimeOrNow`): a producer time in the future or too far in the past
 * becomes the arrival time, so the row never carries two contradicting
 * consent times. Unknown keys and non-object values pass through.
 */
export function clampConsentTimes(
  consents: LeadConsents | null,
  now: Date = new Date()
): LeadConsents | null {
  if (!consents) return null;
  const out: Record<string, unknown> = { ...consents };
  for (const [key, value] of Object.entries(out)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const at = (value as { at?: unknown }).at;
    if (typeof at !== "string") continue;
    out[key] = { ...value, at: consentTimeOrNow(new Date(at), now).toISOString() };
  }
  return out as unknown as LeadConsents;
}

export type PersistLeadResult =
  | { status: "inserted"; id: string }
  | { status: "deduped"; id: string }
  /** Same person within `sameContactWithinDays`: activity on the existing Anfrage. */
  | { status: "same_contact"; id: string };

/** Thrown when the target Praxis is archived (contract ended). */
export class ClinicArchivedError extends Error {
  constructor() {
    super("clinic_archived");
    this.name = "ClinicArchivedError";
  }
}

/**
 * Persist an incoming lead. Returns the new request id (or the existing id
 * if metaLeadId already exists for this clinic — Meta retries are common).
 * Callers must verify HMAC first.
 *
 * This is the ONLY place that creates `requests` rows, so the follow-up work
 * for a new row lives here: PVS token write + AI score (queue, best-effort)
 * and the "Neue Anfrage" email (inline). All of it runs after the response
 * via `after()`, so the caller's answer never waits on pg-boss or Resend.
 */
export async function persistLead(
  clinicId: string,
  input: LeadInput
): Promise<PersistLeadResult> {
  const [clinic] = await db
    .select({ id: schema.clinics.id, archivedAt: schema.clinics.archivedAt })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");
  if (clinic.archivedAt) throw new ClinicArchivedError();

  if (input.sameContactWithinDays && input.sameContactWithinDays > 0) {
    const existingId = await findSameContactRequest(
      clinicId,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.sameContactWithinDays
    );
    if (existingId) {
      if (input.sameContactActivity) {
        await db.insert(schema.requestActivities).values({
          requestId: existingId,
          kind: input.sameContactActivity.kind ?? "messweg",
          body: input.sameContactActivity.body,
          meta: input.sameContactActivity.meta as never,
        });
      }
      return { status: "same_contact", id: existingId };
    }
  }

  const treatmentId = await matchTreatmentId(clinicId, input);
  const contentItemId = await resolveContentItemId(clinicId, input.utm ?? null);
  const booked = input.source === "buchung" && input.appointmentAt ? input.appointmentAt : null;

  const slaRespondBy = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);

  const aiSignals = input.quiz ? { quiz: input.quiz } : null;

  const attr = input.attribution ?? null;
  const selfReportedSource = parseSelfReportedSource(input.selfReportedSource);

  const [row] = await db
    .insert(schema.requests)
    .values({
      clinicId,
      source: input.source,
      sourceCampaignId: input.sourceCampaignId ?? null,
      sourceAdId: input.sourceAdId ?? null,
      utm: input.utm ?? null,
      selfReportedSource,
      attributionConfidence: attributionConfidence({
        source: input.source,
        selfReportedSource,
      }),
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      treatmentWish: input.treatmentWish ?? null,
      treatmentId,
      budgetIndication: input.budgetIndication ?? null,
      message: input.message ?? null,
      aiSignals,
      // A booking over the EINS link is already a booked appointment.
      status: booked ? "termin_vereinbart" : "neu",
      appointmentAt: booked,
      trackingNumberId: input.trackingNumberId ?? null,
      bookingLinkId: input.bookingLinkId ?? null,
      contentItemId,
      slaRespondBy,
      // Form producers persist only consented leads (intake rejects without
      // it, Meta forms require it): consent time from the producer when it is
      // plausible (L-6), else the arrival time. Calls, bookings and front-desk
      // entries carry no consent (dsgvoConsent false): NULL, never a made-up
      // time (0102). Their legal basis is the inquiry itself (Art. 6 (1) b).
      dsgvoConsentAt: input.dsgvoConsent ? consentTimeOrNow(input.consentAt) : null,
      consents: (clampConsentTimes(input.consents ?? null) as never) ?? null,
      dsgvoConsentIp: input.dsgvoConsentIp ?? null,
      rawPayload: (input.rawPayload as never) ?? null,
      metaLeadId: input.metaLeadId ?? null,
      intakeIdempotencyKey: input.intakeIdempotencyKey ?? null,
      fbclid: attr?.fbclid ?? null,
      gclid: attr?.gclid ?? null,
      wbraid: attr?.wbraid ?? null,
      gbraid: attr?.gbraid ?? null,
      fbc: attr?.fbc ?? null,
      fbp: attr?.fbp ?? null,
      ttclid: attr?.ttclid ?? null,
      clickUserAgent: attr?.clickUserAgent ?? null,
      clickIpAnon: attr?.clickIpAnon ?? null,
      // Server time, never a client-supplied timestamp.
      adsConsentAt: input.adsConsent === true ? new Date() : null,
      adsConsentVersion:
        input.adsConsent === true ? input.adsConsentVersion ?? null : null,
    })
    .onConflictDoNothing({
      // No `target:` — relies on any unique index conflict. The only ones
      // in play are `requests_meta_lead_unique` and
      // `requests_intake_idempotency_unique`; both are partial indexes on
      // nullable columns, so a row with neither key set never conflicts.
    })
    .returning({ id: schema.requests.id });

  if (!row) {
    // Conflict on (clinic_id, meta_lead_id) or (clinic_id, idempotency_key).
    // Look up the original row id so the caller can return the canonical
    // id — Meta retries until 2xx, and an idempotent client expects the
    // same id back.
    const existing =
      (input.metaLeadId &&
        (await findByMetaLeadId(clinicId, input.metaLeadId))) ||
      (input.intakeIdempotencyKey &&
        (await findByIntakeIdempotencyKey(
          clinicId,
          input.intakeIdempotencyKey
        )));
    if (existing) return { status: "deduped", id: existing };
    throw new Error("persist_conflict_without_existing_row");
  }

  // Direction A — schedule the EINS-Lead-{8hex} token to be (1) written back
  // into the PVS bemerkung field for write-capable adapters, and (2) logged
  // as a request_activity so MFA can read it off the request detail page.
  // The token is derived deterministically from requests.id (see pvs-token.ts).
  // AI scoring runs for every producer (Meta included, finding C-8). It runs
  // inline after the response (K-5: the contract promises a score within 60
  // minutes and production has no worker), time-boxed; only if that fails or
  // times out is it queued for the worker. processAiScore claims the row
  // (ai_score IS NULL), so a later worker run of the same job is a no-op.
  const id = row.id;
  runAfterResponse(async () => {
    await enqueuePvsLeadTokenWrite(id);
    if (!(await scoreInline(id))) await enqueueAiScore(id);
  });
  scheduleNewRequestNotification(id);

  return { status: "inserted", id };
}

/** Upper bound for the inline score (rules + geocoding + optional OpenAI). */
const AI_SCORE_INLINE_TIMEOUT_MS = 20_000;

/**
 * Score one request now. True when the scorer finished in time (scored or
 * already scored), false on error or timeout. The OpenAI path inside stays
 * gated on the recorded AI consent exactly as in the worker (same function).
 */
async function scoreInline(requestId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { processAiScore } = await import("@/worker/processors/ai-score");
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), AI_SCORE_INLINE_TIMEOUT_MS);
    });
    const out = await Promise.race([
      processAiScore({ requestId }).then(() => "done" as const),
      timeout,
    ]);
    if (out === "timeout") console.warn(`[leads] inline ai-score timed out request=${requestId}`);
    return out === "done";
  } catch (err) {
    console.warn(
      `[leads] inline ai-score failed request=${requestId}:`,
      err instanceof Error ? err.name : "unknown"
    );
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `after()` inside a request scope, fire-and-forget outside (scripts). */
function runAfterResponse(fn: () => Promise<void>): void {
  const run = () =>
    fn().catch((err) =>
      console.warn("[leads] post-insert job failed:", JSON.stringify(describeErrorForLog(err)))
    );
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Link the request to the Praxis's treatment catalogue (finding C-28).
 * Conservative: exact slug match on the landing form's treatmentSlug, else a
 * case-insensitive name match on the treatment label. No fuzzy guessing; a
 * wrong link would be worse than none.
 */
async function matchTreatmentId(
  clinicId: string,
  input: LeadInput
): Promise<string | null> {
  const slug = input.quiz?.treatmentSlug?.trim().toLowerCase() || null;
  const label =
    (input.treatmentWish ?? input.quiz?.treatmentSelection ?? "").trim().toLowerCase() || null;
  if (!slug && !label) return null;
  try {
    const conds = [];
    if (slug) conds.push(eq(schema.treatments.slug, slug));
    if (label) conds.push(sql`lower(${schema.treatments.name}) = ${label}`);
    const rows = await db
      .select({ id: schema.treatments.id, slug: schema.treatments.slug })
      .from(schema.treatments)
      .where(
        and(
          eq(schema.treatments.clinicId, clinicId),
          eq(schema.treatments.isActive, true),
          isNull(schema.treatments.archivedAt),
          or(...conds)
        )
      )
      .limit(5);
    const bySlug = slug ? rows.find((r) => r.slug === slug) : undefined;
    if (bySlug) return bySlug.id;
    return rows.length === 1 ? rows[0]!.id : null;
  } catch (err) {
    // Linking is a nicety; it must never cost the lead.
    console.warn("[leads] treatment match failed:", JSON.stringify(describeErrorForLog(err)));
    return null;
  }
}

/**
 * The post an inquiry came from: utm_content resolved to a content item of
 * the same Praxis. Only values matching the post-code pattern are looked up;
 * an unknown code keeps its raw value in `utm` (listed in the admin).
 */
async function resolveContentItemId(clinicId: string, utm: unknown): Promise<string | null> {
  const code = postCodeFromUtm(utm);
  if (!code) return null;
  try {
    const [row] = await db
      .select({ id: schema.contentItems.id })
      .from(schema.contentItems)
      .where(and(eq(schema.contentItems.clinicId, clinicId), eq(schema.contentItems.code, code)))
      .limit(1);
    return row?.id ?? null;
  } catch (err) {
    // Linking is a nicety; it must never cost the lead.
    console.warn("[leads] post code lookup failed:", JSON.stringify(describeErrorForLog(err)));
    return null;
  }
}

/**
 * Newest non-spam Anfrage of the Praxis with the same e-mail (case-
 * insensitive) or the same phone (last 9 digits, as the patient linker)
 * created within `days`. Null without contact data.
 */
async function findSameContactRequest(
  clinicId: string,
  email: string | null,
  phone: string | null,
  days: number
): Promise<string | null> {
  const emailLower = email?.trim().toLowerCase() || null;
  const key = phoneKey(phone);
  if (!emailLower && !key) return null;
  const rows = await db.execute<{ id: string }>(sql`
    SELECT r.id
    FROM requests r
    WHERE r.clinic_id = ${clinicId}::uuid
      AND r.status <> 'spam'
      AND r.created_at >= now() - make_interval(days => ${days}::int)
      AND (
        (${emailLower}::text IS NOT NULL AND lower(r.contact_email) = ${emailLower}::text)
        OR (${key}::text IS NOT NULL
            AND right(regexp_replace(coalesce(r.contact_phone, ''), '[^0-9]', '', 'g'), ${PHONE_MATCH_DIGITS}) = ${key}::text)
      )
    ORDER BY r.created_at DESC
    LIMIT 1
  `);
  return rows[0]?.id ?? null;
}

async function findByMetaLeadId(
  clinicId: string,
  metaLeadId: string
): Promise<string | null> {
  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        eq(schema.requests.metaLeadId, metaLeadId)
      )
    )
    .limit(1);
  return row?.id ?? null;
}

async function findByIntakeIdempotencyKey(
  clinicId: string,
  key: string
): Promise<string | null> {
  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        eq(schema.requests.intakeIdempotencyKey, key)
      )
    )
    .limit(1);
  return row?.id ?? null;
}
