import type { Adapter } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import { decodeFhirBundle, type FhirBundle } from "../_fhir/normalize-shared.js";
import { HealthHubFhirClient } from "./fhir-client.js";

/**
 * medatixx HealthHub — FHIR Subscription adapter.
 *
 * In production, EINS must be an akkreditierter Software-Partner at medatixx
 * (4–8 weeks Akkreditierungs-Vorlauf). During akkreditierung the link's
 * status is 'akkreditierung' and decodePush is wired against the
 * development tenant; on production approval the inhaber's link flips to
 * 'connected' and the subscription is re-issued against the production
 * endpoint.
 *
 * Subscription handshake is performed once via the setup wizard (see
 * subscription.ts).
 */

export const healthHubAdapter: Adapter = {
  vendor: "healthhub",

  async connect(link: PvsLinkRow) {
    try {
      const client = HealthHubFhirClient.from(link);
      const r = await client.metadata();
      if (!r.fhirVersion) {
        return { ok: false as const, reason: "no fhir capability statement" };
      }
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, reason: (err as Error).message };
    }
  },

  async *initialSync(
    link: PvsLinkRow,
    sinceIso: string
  ): AsyncIterable<CanonicalEvent> {
    const client = HealthHubFhirClient.from(link);
    for await (const bundle of client.searchAll(sinceIso)) {
      for (const event of decodeFhirBundle(link.clinicId, "healthhub", bundle)) {
        yield event;
      }
    }
  },

  decodePush(link: PvsLinkRow, rawBody: string): CanonicalEvent[] {
    const bundle = JSON.parse(rawBody) as FhirBundle;
    return decodeFhirBundle(link.clinicId, "healthhub", bundle);
  },
};
