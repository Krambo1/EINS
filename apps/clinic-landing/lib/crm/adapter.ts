import { isAllowedWebhookUrl } from "./webhook-guard";
import type { CRMAdapterResult, QuizSubmissionPayload } from "../types";

export interface CRMAdapter {
  readonly id: string;
  send(payload: QuizSubmissionPayload, webhookUrl: string): Promise<CRMAdapterResult>;
}

/**
 * Build a normalized lead body that every adapter can derive from.
 * Adapters reshape this to match their target system's expected fields.
 *
 * `type` is "lead" for the initial intake and "marketing-confirmed" for the
 * follow-up event fired after a successful DOI click. Receivers should branch
 * on `type` and key off `patient.email` to upsert.
 */
export function normalizedLead(payload: QuizSubmissionPayload) {
  return {
    type: "lead" as const,
    source: "clinic-landing",
    receivedAt: new Date().toISOString(),
    clinic: payload.clinicSlug,
    treatment: payload.treatmentSlug,
    branch: payload.branch,
    patient: {
      firstName: payload.firstName ?? null,
      email: payload.email,
      phone: payload.phone ?? null,
      city: payload.city ?? null,
    },
    answers: {
      treatment: payload.treatment,
      timeframe: payload.timeframe ?? null,
      experience: payload.experience ?? null,
      notes: payload.notes ?? null,
    },
    consents: payload.consents,
    /**
     * Null on initial intake even if `consents.marketing=true` — the patient
     * still has to click the DOI link. The confirmation route fires a separate
     * `marketing-confirmed` event with a timestamp here.
     */
    marketingConfirmedAt: payload.marketingConfirmedAt ?? null,
    meta: payload.meta,
  };
}

/**
 * Compact follow-up event fired by /api/lead/confirm-marketing once the patient
 * has clicked the double-opt-in link. Receivers should locate the contact by
 * email + clinic and flip the marketing flag from pending → confirmed.
 */
export interface MarketingConfirmedEvent {
  type: "marketing-confirmed";
  source: "clinic-landing";
  receivedAt: string;
  clinic: string;
  treatment: string;
  patient: { email: string };
  /** Original Meta event id from the initial submission (for CRM-side dedup). */
  eventId: string;
  marketingConfirmedAt: string;
}

export async function postMarketingConfirmed(
  webhookUrl: string,
  event: MarketingConfirmedEvent,
): Promise<{ ok: boolean; message?: string }> {
  if (!isAllowedWebhookUrl(webhookUrl)) {
    return { ok: false, message: "webhook_url_blocked" };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, message: res.ok ? undefined : `Webhook responded ${res.status}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
