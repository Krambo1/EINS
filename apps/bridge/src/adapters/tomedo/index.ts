import type { Adapter } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import { TomedoClient } from "./client.js";
import { restSyncMethods } from "../_shared/rest-adapter.js";
import type { StreamSource } from "../_shared/stream-sync.js";
import {
  normalizePatient,
  normalizeAppointmentEvents,
  normalizeEncounter,
  normalizeInvoice,
  normalizeRecall,
} from "./normalize.js";

/**
 * Tomedo (Zollsoft) — REST polling adapter.
 *
 * Auth: OAuth2 client-credentials against the tenant-specific endpoint
 * stored in connection_config.tomedoEndpoint + clientId/clientSecret (the
 * latter encrypted in platform_credentials.platform='pvs' with a "tomedo:"
 * prefix in the access_token_enc field — see setup wizard).
 *
 * Cursor: one ISO watermark per resource (patients, appointments, encounters,
 * invoices, recalls), comma-separated, so one token covers all five streams.
 * Tomedo's API exposes `?modifiedSince=` on each list endpoint. Overlap,
 * clamping, paging caps and resume are shared: see _shared/stream-sync.ts.
 *
 * Dedup ids are stable per row VERSION (patient: id + modifiedAt; appointment /
 * encounter / invoice / recall: id; status change: id + status + modifiedAt),
 * so re-reading the poll overlap re-posts byte-identical events that the portal
 * dedups.
 *
 * Streams run in Patient → Appointment → Encounter → Invoice → Recall order so
 * the portal sees coherent state at every checkpoint.
 */
function sources(
  link: PvsLinkRow,
  signal: AbortSignal | undefined,
  timezone: string
): StreamSource[] {
  const client = TomedoClient.from(link, { signal });
  const clinicId = link.clinicId;
  const opts = { timezone };
  const mod = (r: unknown) => (r as { modifiedAt?: string }).modifiedAt;
  return [
    {
      name: "patients",
      pages: (s, o) => client.pages("patients", s, o),
      toEvents: (r) => [normalizePatient(clinicId, r, opts)],
      modifiedAt: mod,
    },
    {
      name: "appointments",
      pages: (s, o) => client.pages("appointments", s, o),
      toEvents: (r) => normalizeAppointmentEvents(clinicId, r, opts),
      modifiedAt: mod,
    },
    {
      name: "encounters",
      pages: (s, o) => client.pages("encounters", s, o),
      toEvents: (r) => [normalizeEncounter(clinicId, r, opts)],
      modifiedAt: mod,
    },
    {
      name: "invoices",
      pages: (s, o) => client.pages("invoices", s, o),
      // Unpaid invoices normalise to null and are skipped (not an InvoicePaid).
      toEvents: (r) => {
        const e = normalizeInvoice(clinicId, r, opts);
        return e ? [e] : [];
      },
      modifiedAt: mod,
    },
    {
      name: "recalls",
      pages: (s, o) => client.pages("recalls", s, o),
      toEvents: (r) => [normalizeRecall(clinicId, r, opts)],
      modifiedAt: mod,
    },
  ];
}

export const tomedoAdapter: Adapter = {
  vendor: "tomedo",

  async connect(link: PvsLinkRow) {
    try {
      const client = TomedoClient.from(link);
      await client.healthCheck();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, reason: (err as Error).message };
    }
  },

  ...restSyncMethods({ makeSources: sources }),
};
