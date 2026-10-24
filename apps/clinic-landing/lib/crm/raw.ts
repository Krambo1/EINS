import { normalizedLead, type CRMAdapter } from "./adapter";
import { isAllowedWebhookUrl } from "./webhook-guard";
import { webhookHeaders } from "./signing";
import type { QuizSubmissionPayload, CRMAdapterResult } from "../types";

/**
 * Raw adapter: POSTs the normalized payload to whatever webhook URL the clinic
 * configured. Designed for n8n / Make / Zapier where the receiver does its
 * own field mapping. Lowest coupling; recommended default.
 */
export const rawAdapter: CRMAdapter = {
  id: "raw",
  async send(payload: QuizSubmissionPayload, webhookUrl: string): Promise<CRMAdapterResult> {
    if (!isAllowedWebhookUrl(webhookUrl)) {
      return { ok: false, message: "webhook_url_blocked" };
    }
    try {
      // L-16: X-EINS-Signature over the exact body (see ./signing.ts).
      const body = JSON.stringify(normalizedLead(payload));
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: webhookHeaders(payload.clinicSlug, body),
        body,
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? undefined : `Webhook responded ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};
