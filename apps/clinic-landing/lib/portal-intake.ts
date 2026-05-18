import { createHmac } from "node:crypto";
import type { Clinic, QuizSubmissionPayload, Treatment } from "@/lib/types";

/**
 * Portal intake fan-out.
 *
 * The clinic-landing app POSTs every accepted lead to the EINS portal's
 * `/api/leads/intake` route. The portal is the long-term system of record;
 * external CRMs (HubSpot/GHL) are secondary.
 *
 * Security: HMAC-SHA256 over the *exact* JSON body string (not a re-serialized
 * version — re-serializing reorders keys and breaks the signature). The shared
 * secret per clinic lives in an env var whose name is configured on the
 * Clinic object (`portalIntakeSecretEnv`). On the portal side, the same
 * plaintext is stored encrypted in `platform_credentials`.
 *
 * This function is best-effort: a portal outage must never block the patient.
 * The caller wraps it in `.catch(() => undefined)` exactly like the CRM/CAPI
 * adapters.
 */

interface IntakeQuiz {
  treatmentSlug: string;
  treatmentSelection: string;
  /** Category enum from the treatment config — drives value-tier scoring in the portal. */
  treatmentCategory?: string;
  /** Floor of priceRange.fromCents from the treatment config. */
  treatmentValueCents?: number;
  timeframe?: string;
  experience?: string;
  branch: "qualified" | "info-only";
  city?: string;
  notes?: string;
  hasPhone: boolean;
  marketingConsent: boolean;
  /**
   * Explicit patient consent for AI-assisted scoring of the free-text notes
   * field. When false (or absent), the portal worker MUST skip the OpenAI call
   * and use the deterministic fallback — see Art. 9 + Art. 22 + Art. 49 DSGVO.
   */
  aiProcessingConsent: boolean;
  eventId: string;
  sourceUrl?: string;
  fbc?: string;
  fbp?: string;
}

interface IntakeBody {
  clinicId: string;
  source: "formular";
  utm?: Record<string, string>;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  treatmentWish?: string;
  message?: string;
  dsgvoConsent: true;
  quiz: IntakeQuiz;
}

export function mapToIntake(
  payload: QuizSubmissionPayload,
  clinic: Clinic,
  treatment: Treatment
): IntakeBody {
  return {
    clinicId: clinic.portalClinicId,
    source: "formular",
    utm: payload.meta.utm,
    contactName: payload.firstName,
    contactEmail: payload.email,
    contactPhone: payload.phone,
    treatmentWish: payload.treatment,
    message: payload.notes,
    dsgvoConsent: true,
    quiz: {
      treatmentSlug: payload.treatmentSlug,
      treatmentSelection: payload.treatment,
      treatmentCategory: treatment.category,
      treatmentValueCents: treatment.priceRange.fromCents,
      timeframe: payload.timeframe,
      experience: payload.experience,
      branch: payload.branch,
      city: payload.city,
      notes: payload.notes,
      hasPhone: Boolean(payload.phone && payload.phone.length > 0),
      marketingConsent: payload.consents.marketing,
      aiProcessingConsent: payload.consents.aiProcessing,
      eventId: payload.meta.eventId,
      sourceUrl: payload.meta.sourceUrl,
      fbc: payload.meta.fbc,
      fbp: payload.meta.fbp,
    },
  };
}

export function signBody(secret: string, body: string): string {
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

export async function sendToPortal(
  payload: QuizSubmissionPayload,
  clinic: Clinic,
  treatment: Treatment,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const portalUrl = env.PORTAL_URL;
  if (!portalUrl) return;
  if (!clinic.portalClinicId || !clinic.portalIntakeSecretEnv) return;

  const secret = env[clinic.portalIntakeSecretEnv];
  if (!secret) return;

  // Serialize once; sign that exact string; send that exact string.
  const body = JSON.stringify(mapToIntake(payload, clinic, treatment));
  const signature = signBody(secret, body);

  const res = await fetch(`${portalUrl.replace(/\/$/, "")}/api/leads/intake`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-EINS-Signature": signature,
    },
    body,
  });

  if (!res.ok) {
    // Surface failure to logs but never throw — caller swallows.
    const text = await res.text().catch(() => "");
    console.warn(
      `[portal-intake] non-2xx ${res.status} for clinic ${clinic.slug}: ${text.slice(0, 200)}`
    );
  }
}
