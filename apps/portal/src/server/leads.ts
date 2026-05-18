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
}

/**
 * Persist an incoming lead. Returns the new request id.
 * Callers must verify HMAC first.
 */
export async function persistLead(
  clinicId: string,
  input: LeadInput
): Promise<string> {
  const [clinic] = await db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");

  const slaRespondBy = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);

  const aiSignals = input.quiz ? { quiz: input.quiz } : null;

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
    })
    .returning({ id: schema.requests.id });

  // Direction A — schedule the EINS-Lead-{8hex} token to be (1) written back
  // into the PVS bemerkung field for write-capable adapters, and (2) logged
  // as a request_activity so MFA can read it off the request detail page.
  // The token is derived deterministically from requests.id (see pvs-token.ts).
  await enqueuePvsLeadTokenWrite(row!.id);

  return row!.id;
}
