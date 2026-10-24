import type { Adapter } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import {
  PabauClient,
  type PabauPatient,
  type PabauAppointment,
  type PabauEncounter,
  type PabauInvoice,
  type PabauRecall,
} from "./client.js";
import { restSyncMethods } from "../_shared/rest-adapter.js";
import type { StreamSource } from "../_shared/stream-sync.js";
import {
  normalizePatient,
  normalizeAppointment,
  normalizeEncounter,
  normalizeInvoice,
  normalizeRecall,
} from "./normalize.js";

/**
 * Pabau (https://pabau.com) — REST polling adapter.
 *
 * Per-Praxis api_token model (Section 11 verification, 2026-05-21). One
 * pvs_link row per Praxis, with the Pabau-issued token stored encrypted
 * via the existing platform_credentials path.
 *
 * Cursor: comma-separated ISO watermark per resource, identical pattern to the
 * Tomedo adapter so the scheduler treats them interchangeably (overlap,
 * clamping, paging caps and resume: _shared/stream-sync.ts).
 *
 * Dedup ids are stable per row version (patient: id + modified_at; status
 * change: id + status + modified_at; the rest: id), so the poll overlap re-posts
 * byte-identical events that the portal dedups.
 *
 * The five streams run in chronological (Patient → Appointment → Encounter →
 * Invoice → Recall) order so the portal sees coherent state at every
 * checkpoint, matching the temporal causality of clinical events.
 */
function sources(
  link: PvsLinkRow,
  signal: AbortSignal | undefined,
  timezone: string
): StreamSource[] {
  const client = PabauClient.from(link, { signal });
  const clinicId = link.clinicId;
  const opts = { timezone };
  const mod = (r: unknown) => (r as { modified_at?: string }).modified_at;
  return [
    {
      name: "patients",
      pages: (s, o) => client.pages("patients", s, o),
      toEvents: (r) => [normalizePatient(clinicId, r as PabauPatient, opts)],
      modifiedAt: mod,
    },
    {
      name: "appointments",
      pages: (s, o) => client.pages("appointments", s, o),
      toEvents: (r) => normalizeAppointment(clinicId, r as PabauAppointment, opts),
      modifiedAt: mod,
    },
    {
      name: "encounters",
      pages: (s, o) => client.pages("encounters", s, o),
      toEvents: (r) => {
        const e = normalizeEncounter(clinicId, r as PabauEncounter, opts);
        return e ? [e] : [];
      },
      modifiedAt: mod,
    },
    {
      name: "invoices",
      pages: (s, o) => client.pages("invoices", s, o),
      toEvents: (r) => {
        const e = normalizeInvoice(clinicId, r as PabauInvoice, opts);
        return e ? [e] : [];
      },
      modifiedAt: mod,
    },
    {
      name: "recalls",
      pages: (s, o) => client.pages("recalls", s, o),
      toEvents: (r) => {
        const e = normalizeRecall(clinicId, r as PabauRecall, opts);
        return e ? [e] : [];
      },
      modifiedAt: (r) => {
        const x = r as PabauRecall;
        return x.modified_at || x.recall_at;
      },
    },
  ];
}

export const pabauAdapter: Adapter = {
  vendor: "pabau",

  async connect(link: PvsLinkRow) {
    try {
      const client = PabauClient.from(link);
      await client.healthCheck();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, reason: (err as Error).message };
    }
  },

  ...restSyncMethods({ makeSources: sources }),
};
