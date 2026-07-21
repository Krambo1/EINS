import { createHmac } from "node:crypto";
import { anonymizeIp } from "@/lib/meta-capi";
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
  /** Legacy (quiz v1) — kept for wire-compat, no longer collected. */
  experience?: string;
  /** Investment-gate answer (quiz v2, OP flows): ja | unsicher | erst-informieren. */
  budget?: string;
  /** Distance answer (quiz v2, OP flows): in-der-naehe | bis-1-stunde | weiter-entfernt. */
  distance?: string;
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

interface IntakeAttribution {
  /** Meta click id (URL `fbclid` param), 90-day shelf life. */
  fbclid?: string;
  /** Google click id (URL `gclid` param), 90-day shelf life. */
  gclid?: string;
  /** Google iOS-14-era web fallback (URL `wbraid` param). */
  wbraid?: string;
  /** Google iOS-14-era app fallback (URL `gbraid` param). */
  gbraid?: string;
  /** Meta browser-set click id from `_fbc` cookie. */
  fbc?: string;
  /** Meta browser fingerprint from `_fbp` cookie. */
  fbp?: string;
  /** Anonymised client IP (last octet / 4 hextets zeroed). */
  clickIpAnon?: string;
  /** User-agent at lead submission. */
  clickUserAgent?: string;
}

interface IntakeBody {
  clinicId: string;
  source: "formular";
  utm?: Record<string, string>;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  treatmentWish?: string;
  /** Human-readable investment-gate summary, shown in the portal lead view. */
  budgetIndication?: string;
  message?: string;
  dsgvoConsent: true;
  quiz: IntakeQuiz;
  /**
   * Top-level click attribution. Forwarded as typed fields so the portal
   * can persist them onto the requests row for the closed-loop
   * Meta CAPI Purchase + Google Ads OCI workers. fbclid/gclid live in
   * `payload.meta.utm` on the client; we hoist them here.
   */
  attribution?: IntakeAttribution;
}

/**
 * Lift click-IDs out of the loosely-typed `payload.meta.utm` bag (where the
 * client-side `extractUtm()` parks them next to the real UTMs) into a
 * typed `attribution` envelope the portal can persist directly.
 */
function buildAttribution(
  payload: QuizSubmissionPayload,
  clientIp: string | undefined,
  userAgent: string | undefined
): IntakeAttribution | undefined {
  const utm = payload.meta.utm ?? {};
  const out: IntakeAttribution = {};
  if (utm.fbclid) out.fbclid = utm.fbclid;
  if (utm.gclid) out.gclid = utm.gclid;
  if (utm.wbraid) out.wbraid = utm.wbraid;
  if (utm.gbraid) out.gbraid = utm.gbraid;
  if (payload.meta.fbc) out.fbc = payload.meta.fbc;
  if (payload.meta.fbp) out.fbp = payload.meta.fbp;
  if (clientIp) out.clickIpAnon = anonymizeIp(clientIp);
  if (userAgent) out.clickUserAgent = userAgent;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Investment-gate answer → human-readable line for the portal lead view. */
const BUDGET_LABELS: Record<string, string> = {
  ja: "Investitionsrahmen passt",
  unsicher: "Investitionsrahmen unsicher",
  "erst-informieren": "Möchte erst Informationen",
};

export function mapToIntake(
  payload: QuizSubmissionPayload,
  clinic: Clinic,
  treatment: Treatment,
  attributionExtras?: { clientIp?: string; userAgent?: string }
): IntakeBody {
  return {
    clinicId: clinic.portalClinicId,
    source: "formular",
    utm: payload.meta.utm,
    contactName: payload.firstName,
    contactEmail: payload.email,
    contactPhone: payload.phone,
    treatmentWish: payload.treatment,
    budgetIndication: payload.budget ? BUDGET_LABELS[payload.budget] ?? payload.budget : undefined,
    message: payload.notes,
    dsgvoConsent: true,
    quiz: {
      treatmentSlug: payload.treatmentSlug,
      treatmentSelection: payload.treatment,
      treatmentCategory: treatment.category,
      treatmentValueCents: treatment.priceRange.fromCents,
      timeframe: payload.timeframe,
      experience: payload.experience,
      budget: payload.budget,
      distance: payload.distance,
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
    attribution: buildAttribution(
      payload,
      attributionExtras?.clientIp,
      attributionExtras?.userAgent
    ),
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
  env: NodeJS.ProcessEnv,
  attributionExtras?: { clientIp?: string; userAgent?: string }
): Promise<void> {
  const portalUrl = env.PORTAL_URL;
  if (!portalUrl) return;
  if (!clinic.portalClinicId || !clinic.portalIntakeSecretEnv) return;

  const secret = env[clinic.portalIntakeSecretEnv];
  if (!secret) return;

  // Serialize once; sign that exact string; send that exact string.
  const body = JSON.stringify(
    mapToIntake(payload, clinic, treatment, attributionExtras)
  );
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
