import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { SLA_HOURS, type Plan, type RequestSource } from "@/lib/constants";
import { decryptString } from "@/lib/crypto";

/**
 * Verify an HMAC-signed lead payload. The clinic's lead-intake secret is
 * stored encrypted in platform_credentials with platform="intake".
 *
 * Wire format: HMAC-SHA256 over the raw body, header X-EINS-Signature: sha256=<hex>.
 * Constant-time compare.
 */
export async function verifyLeadSignature(
  clinicId: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader) return false;
  const match = signatureHeader.match(/^sha256=([0-9a-f]+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]!, "hex");
  if (provided.length !== 32) return false;

  const [cred] = await db
    .select({ accessTokenEnc: schema.platformCredentials.accessTokenEnc })
    .from(schema.platformCredentials)
    .where(eq(schema.platformCredentials.clinicId, clinicId))
    .limit(1);
  if (!cred?.accessTokenEnc) return false;

  const secret = decryptString(cred.accessTokenEnc);
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return expected.length === provided.length && timingSafeEqual(expected, provided);
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
}

/**
 * Persist an incoming lead. SLA respond-by is computed from the clinic's plan.
 * Returns the new request id. Callers must verify HMAC first.
 */
export async function persistLead(
  clinicId: string,
  input: LeadInput
): Promise<string> {
  // Plan → SLA.
  const [clinic] = await db
    .select({ plan: schema.clinics.plan })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");

  const slaHours = SLA_HOURS[clinic.plan as Plan] ?? 24;
  const slaRespondBy = new Date(Date.now() + slaHours * 60 * 60 * 1000);

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
      status: "neu",
      slaRespondBy,
      dsgvoConsentAt: input.dsgvoConsent ? new Date() : new Date(),
      dsgvoConsentIp: input.dsgvoConsentIp ?? null,
      rawPayload: (input.rawPayload as never) ?? null,
    })
    .returning({ id: schema.requests.id });

  return row!.id;
}
