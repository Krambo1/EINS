import { normalizedLead, type CRMAdapter } from "./adapter";
import type { QuizSubmissionPayload, CRMAdapterResult } from "../types";

/**
 * HubSpot adapter — POSTs to a HubSpot Forms API endpoint that the clinic
 * provisions in HubSpot Free EU. The webhookUrl passed in is expected to be:
 *
 *   https://api.hsforms.com/submissions/v3/integration/submit/{portalId}/{formGuid}
 *
 * (HubSpot Free supports unlimited form submissions.)
 *
 * If the clinic instead runs a private app + workflow trigger, switch to
 * `LEAD_CRM_ADAPTER=raw` and proxy through n8n — much more flexible.
 */
export const hubspotAdapter: CRMAdapter = {
  id: "hubspot",
  async send(payload: QuizSubmissionPayload, formsUrl: string): Promise<CRMAdapterResult> {
    const lead = normalizedLead(payload);
    const fields: { objectTypeId: string; name: string; value: string }[] = [
      { objectTypeId: "0-1", name: "email", value: lead.patient.email },
      { objectTypeId: "0-1", name: "firstname", value: lead.patient.firstName ?? "" },
      { objectTypeId: "0-1", name: "phone", value: lead.patient.phone ?? "" },
      { objectTypeId: "0-1", name: "city", value: lead.patient.city ?? "" },
      { objectTypeId: "0-1", name: "treatment_interest", value: String(lead.answers.treatment) },
      { objectTypeId: "0-1", name: "treatment_timeframe", value: String(lead.answers.timeframe ?? "") },
      { objectTypeId: "0-1", name: "treatment_experience", value: String(lead.answers.experience ?? "") },
      { objectTypeId: "0-1", name: "lead_branch", value: lead.branch },
      { objectTypeId: "0-1", name: "source_clinic", value: lead.clinic },
    ];

    const body = {
      fields: fields.filter((f) => f.value !== ""),
      legalConsentOptions: {
        consent: {
          consentToProcess: lead.consents.privacy,
          text: "Patient hat der Verarbeitung der Daten zur Bearbeitung der Anfrage zugestimmt.",
          communications: lead.consents.marketing
            ? [
                {
                  value: true,
                  subscriptionTypeId: 999,
                  text: "Patient möchte Informationen zur Behandlung erhalten.",
                },
              ]
            : [],
        },
      },
      context: {
        pageUri: lead.meta.sourceUrl,
        pageName: `${lead.clinic} – ${lead.treatment}`,
      },
    };

    try {
      const res = await fetch(formsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? undefined : `HubSpot responded ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};
