import type { Adapter, AdapterPollResult } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import { ConsentzClient } from "./client.js";
import { pickMaxIso } from "../_shared/iso.js";
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
 * the scheduler treats them uniformly.
 *
 * Vendor API docs are not public as of 2026-05-21; endpoint paths and
 * field shapes below mirror the resource taxonomy Consentz exposes on
 * their product pages. Calibrate at first-Praxis onboarding; the portal
 * dedup index keeps replays safe during that calibration period.
 */
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

  async *initialSync(
    link: PvsLinkRow,
    sinceIso: string
  ): AsyncIterable<CanonicalEvent> {
    const client = ConsentzClient.from(link);
    for await (const p of client.streamPatients(sinceIso)) {
      yield normalizePatient(link.clinicId, p);
    }
    for await (const a of client.streamAppointments(sinceIso)) {
      for (const event of normalizeAppointment(link.clinicId, a)) yield event;
    }
    for await (const e of client.streamEncounters(sinceIso)) {
      const event = normalizeEncounter(link.clinicId, e);
      if (event) yield event;
    }
    for await (const i of client.streamPayments(sinceIso)) {
      const event = normalizePayment(link.clinicId, i);
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
    const client = ConsentzClient.from(link);
    const cursors = parseCursor(cursor);
    const events: CanonicalEvent[] = [];
    const newCursors = { ...cursors };

    for await (const p of client.streamPatients(cursors.patients)) {
      events.push(normalizePatient(link.clinicId, p));
      newCursors.patients = pickMaxIso(newCursors.patients, p.updated_at);
    }
    for await (const a of client.streamAppointments(cursors.appointments)) {
      for (const event of normalizeAppointment(link.clinicId, a)) events.push(event);
      newCursors.appointments = pickMaxIso(newCursors.appointments, a.updated_at);
    }
    for await (const e of client.streamEncounters(cursors.encounters)) {
      const event = normalizeEncounter(link.clinicId, e);
      if (event) events.push(event);
      newCursors.encounters = pickMaxIso(newCursors.encounters, e.updated_at);
    }
    for await (const i of client.streamPayments(cursors.invoices)) {
      const event = normalizePayment(link.clinicId, i);
      if (event) events.push(event);
      newCursors.invoices = pickMaxIso(newCursors.invoices, i.updated_at);
    }
    for await (const r of client.streamRecalls(cursors.recalls)) {
      const event = normalizeRecall(link.clinicId, r);
      if (event) events.push(event);
      newCursors.recalls = pickMaxIso(
        newCursors.recalls,
        r.updated_at ?? r.recall_at
      );
    }

    return {
      events,
      nextCursor: serializeCursor(newCursors),
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
