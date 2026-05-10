import type { CRMAdapterResult, QuizSubmissionPayload } from "../types";

export interface CRMAdapter {
  readonly id: string;
  send(payload: QuizSubmissionPayload, webhookUrl: string): Promise<CRMAdapterResult>;
}

/**
 * Build a normalized lead body that every adapter can derive from.
 * Adapters reshape this to match their target system's expected fields.
 */
export function normalizedLead(payload: QuizSubmissionPayload) {
  return {
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
    meta: payload.meta,
  };
}
