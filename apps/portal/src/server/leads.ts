import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { SLA_HOURS, type RequestSource } from "@/lib/constants";
import { verifyClinicSignature } from "@/server/clinic-signature";
import { enqueuePvsLeadTokenWrite } from "@/server/jobs";

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
  clickUserAgent: string | null;
  /** Anonymised IP (last octet / 4 hextets zeroed). Never the raw IP. */
  clickIpAnon: string | null;
}

export interface LeadInput {
  source: RequestSource;
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
  utm?: Record<string, string> | null;
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
}

export type PersistLeadResult =
  | { status: "inserted"; id: string }
  | { status: "deduped"; id: string };

/**
 * Persist an incoming lead. Returns the new request id (or the existing id
 * if metaLeadId already exists for this clinic — Meta retries are common).
 * Callers must verify HMAC first.
 */
export async function persistLead(
  clinicId: string,
  input: LeadInput
): Promise<PersistLeadResult> {
  const [clinic] = await db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");

  const slaRespondBy = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);

  const aiSignals = input.quiz ? { quiz: input.quiz } : null;

  const attr = input.attribution ?? null;

  const [row] = await db
    .insert(schema.requests)
    .values({
      clinicId,
      source: input.source,
      sourceCampaignId: input.sourceCampaignId ?? null,
      sourceAdId: input.sourceAdId ?? null,
      utm: input.utm ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      treatmentWish: input.treatmentWish ?? null,
      budgetIndication: input.budgetIndication ?? null,
      message: input.message ?? null,
      aiSignals,
      status: "neu",
      slaRespondBy,
      dsgvoConsentAt: input.dsgvoConsent ? new Date() : new Date(),
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
      clickUserAgent: attr?.clickUserAgent ?? null,
      clickIpAnon: attr?.clickIpAnon ?? null,
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
  await enqueuePvsLeadTokenWrite(row.id);

  return { status: "inserted", id: row.id };
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
