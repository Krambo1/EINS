import { createHmac } from "node:crypto";
import { anonymizeIp } from "@/lib/meta-capi";
import {
  AI_CONSENT_VERSION,
  MARKETING_CONSENT_VERSION,
  PRIVACY_CONSENT_VERSION,
} from "@/lib/consent-versions";
import {
  parseLandingSelfReportedSource,
  type LandingSelfReportedSource,
} from "@/lib/self-reported-source";
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
 * The portal is the system of record, so this relay is NOT best-effort: it
 * retries with a timeout, sends the form's eventId as Idempotency-Key, and
 * reports failure to the caller, which must then show the patient an error
 * (with the Praxis phone number) instead of a success screen.
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
  /** TikTok click id (URL `ttclid` param). Attribution only, never reported to TikTok. */
  ttclid?: string;
  /** Anonymised client IP (last octet / 4 hextets zeroed). */
  clickIpAnon?: string;
  /** User-agent at lead submission. */
  clickUserAgent?: string;
}

interface IntakeBody {
  clinicId: string;
  source: "formular";
  utm?: Record<string, string>;
  /**
   * Optional "Wie sind Sie auf uns aufmerksam geworden?" answer, closed list
   * only. Goes to requests.self_reported_source; never changes the Messweg.
   */
  selfReportedSource?: LandingSelfReportedSource;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  treatmentWish?: string;
  /** Human-readable investment-gate summary, shown in the portal lead view. */
  budgetIndication?: string;
  message?: string;
  dsgvoConsent: true;
  /**
   * The patient's IP as consent proof, anonymised like clickIpAnon. Sent as
   * a body field because the portal only sees this server's egress IP.
   */
  consentIp?: string;
  quiz: IntakeQuiz;
  /**
   * Top-level click attribution. Forwarded as typed fields so the portal
   * can persist them onto the requests row for the closed-loop
   * Meta CAPI Purchase + Google Ads OCI workers. fbclid/gclid live in
   * `payload.meta.utm` on the client; we hoist them here.
   */
  attribution?: IntakeAttribution;
  /**
   * Separate, optional consent to report this inquiry and a later treatment
   * to Meta and Google. The portal stores it (requests.ads_consent_at) and
   * its purchase workers report nothing without it.
   */
  adsConsent: boolean;
  /** Version of the consent text; only sent with consent. */
  adsConsentVersion?: string;
  /**
   * Consent record (L-6): versions of the texts the person agreed to and the
   * time this server accepted the submit. The portal stores it on the
   * request (requests.consents) and uses `at` as the DSGVO consent time.
   */
  consentRecord: {
    privacyVersion: string;
    ageGate: boolean;
    aiVersion?: string;
    marketingVersion?: string;
    at: string;
  };
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
  if (utm.fbclid) out.fbclid = cap(utm.fbclid, 256);
  if (utm.gclid) out.gclid = cap(utm.gclid, 256);
  if (utm.wbraid) out.wbraid = cap(utm.wbraid, 256);
  if (utm.gbraid) out.gbraid = cap(utm.gbraid, 256);
  if (utm.ttclid) out.ttclid = cap(utm.ttclid, 256);
  if (payload.meta.fbc) out.fbc = cap(payload.meta.fbc, 256);
  if (payload.meta.fbp) out.fbp = cap(payload.meta.fbp, 256);
  if (clientIp) out.clickIpAnon = cap(anonymizeIp(clientIp), 64);
  if (userAgent) out.clickUserAgent = cap(userAgent, 500);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Cut an optional string to `max` chars (portal column caps). */
function cap(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** At most 30 UTM entries, keys 100 and values 500 chars. */
function capRecord(
  rec: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec).slice(0, 30)) {
    out[k.slice(0, 100)] = String(v).slice(0, 500);
  }
  return out;
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
  attributionExtras?: { clientIp?: string; userAgent?: string },
  /** Submit time; fixed by the caller so retries send the same body. */
  consentAt?: Date
): IntakeBody {
  // Every free-form string is cut to the portal's column caps here, so an
  // overlong ad URL or user agent can never cost the whole inquiry.
  const consentIp = attributionExtras?.clientIp
    ? anonymizeIp(attributionExtras.clientIp)
    : "";
  return {
    clinicId: clinic.portalClinicId,
    source: "formular",
    utm: capRecord(payload.meta.utm),
    selfReportedSource: parseLandingSelfReportedSource(payload.selfReportedSource),
    contactName: cap(payload.firstName, 200),
    contactEmail: payload.email,
    contactPhone: cap(payload.phone, 64),
    treatmentWish: cap(payload.treatment, 500),
    budgetIndication: payload.budget ? BUDGET_LABELS[payload.budget] ?? payload.budget : undefined,
    message: cap(payload.notes, 5000),
    dsgvoConsent: true,
    consentIp: consentIp || undefined,
    quiz: {
      treatmentSlug: cap(payload.treatmentSlug, 120) ?? "",
      treatmentSelection: cap(payload.treatment, 120) ?? "",
      treatmentCategory: treatment.category,
      treatmentValueCents: treatment.priceRange.fromCents,
      timeframe: payload.timeframe,
      experience: payload.experience,
      budget: payload.budget,
      distance: payload.distance,
      branch: payload.branch,
      city: cap(payload.city, 80),
      notes: cap(payload.notes, 1000),
      hasPhone: Boolean(payload.phone && payload.phone.length > 0),
      marketingConsent: payload.consents.marketing,
      aiProcessingConsent: payload.consents.aiProcessing,
      eventId: cap(payload.meta.eventId, 200) ?? "",
      sourceUrl: cap(payload.meta.sourceUrl, 500),
      fbc: cap(payload.meta.fbc, 200),
      fbp: cap(payload.meta.fbp, 200),
    },
    attribution: buildAttribution(
      payload,
      attributionExtras?.clientIp,
      attributionExtras?.userAgent
    ),
    consentRecord: {
      privacyVersion: PRIVACY_CONSENT_VERSION,
      ageGate: payload.consents.ageGate === true,
      aiVersion: payload.consents.aiProcessing ? AI_CONSENT_VERSION : undefined,
      marketingVersion: payload.consents.marketing ? MARKETING_CONSENT_VERSION : undefined,
      at: (consentAt ?? new Date()).toISOString(),
    },
    adsConsent: payload.consents.adsMeasurement === true,
    adsConsentVersion:
      payload.consents.adsMeasurement === true
        ? payload.consents.adsMeasurementVersion
        : undefined,
  };
}

export function signBody(secret: string, body: string): string {
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

/**
 * Outcome of the portal relay.
 *   accepted  the portal stored the inquiry (or already had it: dedup by
 *             Idempotency-Key = the form's eventId).
 *   disabled  this clinic has no portal mirror (empty portalClinicId).
 *   failed    configuration missing or the portal did not accept after all
 *             attempts. The caller must NOT tell the patient it worked.
 */
export type PortalRelayResult =
  | { status: "accepted"; attempts: number }
  | { status: "disabled" }
  | { status: "failed"; reason: string; attempts: number };

const RELAY_ATTEMPTS = 3;
const RELAY_TIMEOUT_MS = 6_000;
const RELAY_BACKOFF_MS = [400, 1_200];

/** Retry only what a second try can fix: network errors, timeouts, 5xx. */
function retryableStatus(status: number): boolean {
  return status >= 500 || status === 408;
}

export async function sendToPortal(
  payload: QuizSubmissionPayload,
  clinic: Clinic,
  treatment: Treatment,
  env: NodeJS.ProcessEnv,
  attributionExtras?: { clientIp?: string; userAgent?: string },
  deps: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<PortalRelayResult> {
  // An empty portalClinicId is the documented "no portal mirror" switch.
  if (!clinic.portalClinicId) return { status: "disabled" };

  // From here on the clinic SHOULD reach the portal: missing configuration
  // is a failure, never a silent skip.
  const portalUrl = env.PORTAL_URL;
  if (!portalUrl) return { status: "failed", reason: "config_missing_PORTAL_URL", attempts: 0 };
  if (!clinic.portalIntakeSecretEnv) {
    return { status: "failed", reason: "config_missing_portalIntakeSecretEnv", attempts: 0 };
  }
  const secret = env[clinic.portalIntakeSecretEnv];
  if (!secret) {
    return {
      status: "failed",
      reason: `config_missing_${clinic.portalIntakeSecretEnv}`,
      attempts: 0,
    };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Serialize once; sign that exact string; send that exact string.
  const body = JSON.stringify(
    mapToIntake(payload, clinic, treatment, attributionExtras, new Date())
  );
  const signature = signBody(secret, body);
  // Stable per form fill: a retry (ours or the patient's) collapses into the
  // same portal row instead of creating a second one.
  const idempotencyKey = payload.meta.eventId.slice(0, 200);
  const url = `${portalUrl.replace(/\/$/, "")}/api/leads/intake`;

  let lastReason = "unknown";
  for (let attempt = 1; attempt <= RELAY_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-EINS-Signature": signature,
          "Idempotency-Key": idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.ok) return { status: "accepted", attempts: attempt };
      lastReason = `http_${res.status}`;
      // Drain the body so the connection can be reused; never log it.
      await res.text().catch(() => "");
      if (!retryableStatus(res.status)) {
        return { status: "failed", reason: lastReason, attempts: attempt };
      }
    } catch (err) {
      lastReason =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
          ? "timeout"
          : "network";
    }
    if (attempt < RELAY_ATTEMPTS) {
      await sleep(RELAY_BACKOFF_MS[attempt - 1] ?? 1_200);
    }
  }
  return { status: "failed", reason: lastReason, attempts: RELAY_ATTEMPTS };
}
