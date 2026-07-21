import type { Adapter } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import { decodeFhirBundle, type FhirBundle } from "../_fhir/normalize-shared.js";
import { RedFhirClient } from "./fhir-client.js";

/**
 * RED interchange — FHIR Subscription adapter.
 *
 * Auth model differs from HealthHub: RED issues per-Praxis client
 * credentials directly in the RED admin panel, no Akkreditierung needed.
 * Otherwise mirrors HealthHub's flow (FHIR R4 Subscription resource,
 * inbound webhook to /webhooks/red/:linkId).
 *
 * 80% of code lives in _fhir/normalize-shared.ts.
 */

export const redAdapter: Adapter = {
  vendor: "red",

  async connect(link: PvsLinkRow) {
    try {
      const client = RedFhirClient.from(link);
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
    const client = RedFhirClient.from(link);
    for await (const bundle of client.searchAll(sinceIso)) {
      for (const event of decodeFhirBundle(link.clinicId, "red", bundle)) {
        yield event;
      }
    }
  },

  decodePush(link: PvsLinkRow, rawBody: string): CanonicalEvent[] {
    // Guard the parse: a malformed-but-correctly-signed body must surface as a
    // decode error the inbound route can turn into a non-retryable 400, so the
    // vendor stops redelivering the same poison delivery forever (a raw
    // JSON.parse throw would 500 and invite an endless retry storm).
    let bundle: FhirBundle;
    try {
      bundle = JSON.parse(rawBody) as FhirBundle;
    } catch (err) {
      throw new Error(
        `red decodePush: body is not valid JSON: ${(err as Error).message}`
      );
    }
    return decodeFhirBundle(link.clinicId, "red", bundle);
  },
};
