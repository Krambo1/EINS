import { normalizedLead, type CRMAdapter } from "./adapter";
import { isAllowedWebhookUrl } from "./webhook-guard";
import type { QuizSubmissionPayload, CRMAdapterResult } from "../types";

/**
 * GoHighLevel inbound webhook adapter.
 *
 * The clinic creates an "Inbound Webhook" trigger in GHL Workflows; that yields
 * a unique `https://services.leadconnectorhq.com/hooks/...` URL which becomes
 * `clinic.connectors.webhookUrl` in `clinic.ts`.
 *
 * GHL accepts arbitrary JSON and exposes every key as a custom field. We send
 * a flat shape with semantic field names so the workflow author can map directly.
 */
export const ghlAdapter: CRMAdapter = {
  id: "ghl",
  async send(payload: QuizSubmissionPayload, webhookUrl: string): Promise<CRMAdapterResult> {
    if (!isAllowedWebhookUrl(webhookUrl)) {
      return { ok: false, message: "webhook_url_blocked" };
    }
    const lead = normalizedLead(payload);
    const flat = {
      first_name: lead.patient.firstName ?? "",
      email: lead.patient.email,
      phone: lead.patient.phone ?? "",
      city: lead.patient.city ?? "",
      country: "DE",
      treatment_interest: lead.answers.treatment ?? "",
      treatment_timeframe: lead.answers.timeframe ?? "",
      treatment_experience: lead.answers.experience ?? "",
      lead_branch: lead.branch,
      source_clinic: lead.clinic,
      source_treatment: lead.treatment,
      source_url: lead.meta.sourceUrl,
      consent_privacy: lead.consents.privacy ? "yes" : "no",
      consent_age_gate: lead.consents.ageGate ? "yes" : "no",
      consent_marketing: lead.consents.marketing ? "yes" : "no",
      received_at: lead.receivedAt,
      tags: [`treatment:${lead.treatment}`, `branch:${lead.branch}`],
    };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(flat),
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? undefined : `GHL responded ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};
