import type { Adapter, AdapterPollResult } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import { PabauClient } from "./client.js";
import { pickMaxIso } from "../_shared/iso.js";
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
 * Cursor: comma-separated max(modified_at) per resource, identical pattern
 * to the Tomedo adapter so the scheduler treats them interchangeably.
 *
 * The five streams are paginated in chronological (Patient → Appointment →
 * Encounter → Invoice → Recall) order so the portal sees coherent state at
 * every checkpoint, matching the temporal causality of clinical events.
 */
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

  async *initialSync(
    link: PvsLinkRow,
    sinceIso: string
  ): AsyncIterable<CanonicalEvent> {
    const client = PabauClient.from(link);
    for await (const p of client.streamPatients(sinceIso)) {
      yield normalizePatient(link.clinicId, p);
    }
    for await (const a of client.streamAppointments(sinceIso)) {
      for (const event of normalizeAppointment(link.clinicId, a)) {
        yield event;
      }
    }
    for await (const e of client.streamEncounters(sinceIso)) {
      const event = normalizeEncounter(link.clinicId, e);
      if (event) yield event;
    }
    for await (const i of client.streamInvoices(sinceIso)) {
      const event = normalizeInvoice(link.clinicId, i);
      if (event) yield event;
    }
    for await (const r of client.streamRecalls(sinceIso)) {
      const event = normalizeRecall(link.clinicId, r);
      if (event) yield event;
    }
  },

  async poll(
    link: PvsLinkRow,
    cursor: string | null
  ): Promise<AdapterPollResult> {
    const client = PabauClient.from(link);
    const cursors = parseCursor(cursor);
    const events: CanonicalEvent[] = [];
    const newCursors = { ...cursors };

    for await (const p of client.streamPatients(cursors.patients)) {
      events.push(normalizePatient(link.clinicId, p));
      newCursors.patients = pickMaxIso(newCursors.patients, p.modified_at);
    }
    for await (const a of client.streamAppointments(cursors.appointments)) {
      for (const event of normalizeAppointment(link.clinicId, a)) {
        events.push(event);
      }
      newCursors.appointments = pickMaxIso(newCursors.appointments, a.modified_at);
    }
    for await (const e of client.streamEncounters(cursors.encounters)) {
      const event = normalizeEncounter(link.clinicId, e);
      if (event) events.push(event);
      newCursors.encounters = pickMaxIso(newCursors.encounters, e.modified_at);
    }
    for await (const i of client.streamInvoices(cursors.invoices)) {
      const event = normalizeInvoice(link.clinicId, i);
      if (event) events.push(event);
      newCursors.invoices = pickMaxIso(newCursors.invoices, i.modified_at);
    }
    for await (const r of client.streamRecalls(cursors.recalls)) {
      const event = normalizeRecall(link.clinicId, r);
      if (event) events.push(event);
      newCursors.recalls = pickMaxIso(
        newCursors.recalls,
        r.modified_at ?? r.recall_at
      );
    }

    return {
      events,
      nextCursor: serializeCursor(newCursors),
      // Pabau's rate ceiling is comfortably above one tick/minute, so the
      // empty-poll back-off matches Tomedo: 5 min when nothing changed,
      // 60 s when there was work to do.
      recommendedDelayMs: events.length === 0 ? 5 * 60_000 : 60_000,
    };
  },

  seedCursor(syncStartIso: string): string {
    // Initial-sync watermark handoff (C7); see tomedo/index.ts for the
    // rationale.
    return serializeCursor({
      patients: syncStartIso,
      appointments: syncStartIso,
      encounters: syncStartIso,
      invoices: syncStartIso,
      recalls: syncStartIso,
    });
  },
};

interface Cursors {
  patients: string;
  appointments: string;
  encounters: string;
  invoices: string;
  recalls: string;
}

function parseCursor(input: string | null): Cursors {
  const epoch = "1970-01-01T00:00:00.000Z";
  if (!input) {
    return {
      patients: epoch,
      appointments: epoch,
      encounters: epoch,
      invoices: epoch,
      recalls: epoch,
    };
  }
  const parts = input.split(",");
  const get = (idx: number) => parts[idx] ?? epoch;
  return {
    patients: get(0),
    appointments: get(1),
    encounters: get(2),
    invoices: get(3),
    recalls: get(4),
  };
}

function serializeCursor(c: Cursors): string {
  return [
    c.patients,
    c.appointments,
    c.encounters,
    c.invoices,
    c.recalls,
  ].join(",");
}
