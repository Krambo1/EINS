import type { Adapter } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import {
  ConsentzClient,
  type ConsentzClient_Patient,
  type ConsentzAppointment,
  type ConsentzTreatmentNote,
  type ConsentzPayment,
  type ConsentzRecall,
} from "./client.js";
import { restSyncMethods } from "../_shared/rest-adapter.js";
import type { StreamSource } from "../_shared/stream-sync.js";
import {
  normalizePatient,
  normalizeAppointment,
  normalizeEncounter,
  normalizePayment,
  normalizeRecall,
} from "./normalize.js";

/**
 * Consentz (https://www.consentz.com) — REST polling adapter.
 *
 * Per-Praxis API token + per-tenant endpoint, both stored encrypted via
 * platform_credentials. Same five-stream pattern as Pabau and Tomedo so
 * the scheduler treats them uniformly (overlap, clamping, paging caps and
 * resume: _shared/stream-sync.ts). The "invoices" cursor slot carries the
 * payments stream.
 *
 * Dedup ids are stable per row version (patient: id + updated_at; status
 * change: id + status + updated_at; the rest: id), so the poll overlap re-posts
 * byte-identical events that the portal dedups.
 *
 * Vendor API docs are not public as of 2026-05-21; endpoint paths and
 * field shapes below mirror the resource taxonomy Consentz exposes on
 * their product pages. Calibrate at first-Praxis onboarding; the portal
 * dedup index keeps replays safe during that calibration period.
 */
function sources(
  link: PvsLinkRow,
  signal: AbortSignal | undefined,
  timezone: string
): StreamSource[] {
  const client = ConsentzClient.from(link, { signal });
  const clinicId = link.clinicId;
  const opts = { timezone };
  const mod = (r: unknown) => (r as { updated_at?: string }).updated_at;
  return [
    {
      name: "patients",
      pages: (s, o) => client.pages("patients", s, o),
      toEvents: (r) => [normalizePatient(clinicId, r as ConsentzClient_Patient, opts)],
      modifiedAt: mod,
    },
    {
      name: "appointments",
      pages: (s, o) => client.pages("appointments", s, o),
      toEvents: (r) => normalizeAppointment(clinicId, r as ConsentzAppointment, opts),
      modifiedAt: mod,
    },
    {
      name: "encounters",
      pages: (s, o) => client.pages("encounters", s, o),
      toEvents: (r) => {
        const e = normalizeEncounter(clinicId, r as ConsentzTreatmentNote, opts);
        return e ? [e] : [];
      },
      modifiedAt: mod,
    },
    {
      name: "invoices",
      pages: (s, o) => client.pages("payments", s, o),
      toEvents: (r) => {
        const e = normalizePayment(clinicId, r as ConsentzPayment, opts);
        return e ? [e] : [];
      },
      modifiedAt: mod,
    },
    {
      name: "recalls",
      pages: (s, o) => client.pages("recalls", s, o),
      toEvents: (r) => {
        const e = normalizeRecall(clinicId, r as ConsentzRecall, opts);
        return e ? [e] : [];
      },
      modifiedAt: (r) => {
        const x = r as ConsentzRecall;
        return x.updated_at || x.recall_at;
      },
    },
  ];
}

export const consentzAdapter: Adapter = {
  vendor: "consentz",

  async connect(link: PvsLinkRow) {
    try {
      const client = ConsentzClient.from(link);
      await client.healthCheck();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, reason: (err as Error).message };
    }
  },

  ...restSyncMethods({ makeSources: sources }),
};
