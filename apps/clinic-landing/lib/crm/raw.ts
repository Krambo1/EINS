import { normalizedLead, type CRMAdapter } from "./adapter";
import type { QuizSubmissionPayload, CRMAdapterResult } from "../types";

/**
 * Raw adapter: POSTs the normalized payload to whatever webhook URL the clinic
 * configured. Designed for n8n / Make / Zapier where the receiver does its
 * own field mapping. Lowest coupling; recommended default.
 */
export const rawAdapter: CRMAdapter = {
  id: "raw",
  async send(payload: QuizSubmissionPayload, webhookUrl: string): Promise<CRMAdapterResult> {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(normalizedLead(payload)),
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? undefined : `Webhook responded ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};
