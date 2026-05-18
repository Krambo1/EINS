import type { Adapter, AdapterPollResult } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import { TomedoClient } from "./client.js";
import {
  normalizePatient,
  normalizeAppointment,
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
 * Cursor: `${resource}:${maxModifiedAt}` per resource, concatenated as a
 * comma-separated string so one cursor token covers all five streams.
 * Tomedo's API exposes `?modifiedSince=` on each list endpoint.
 */
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

  async *initialSync(
    link: PvsLinkRow,
    sinceIso: string
  ): AsyncIterable<CanonicalEvent> {
    const client = TomedoClient.from(link);
    // Stream in this order so the portal sees Patient → Appointment →
    // Encounter → Invoice → Recall — matches the temporal order events
    // typically happen in.
    for await (const p of client.streamPatients(sinceIso)) {
      yield normalizePatient(link.clinicId, p);
    }
    for await (const a of client.streamAppointments(sinceIso)) {
      yield normalizeAppointment(link.clinicId, a);
    }
    for await (const e of client.streamEncounters(sinceIso)) {
      yield normalizeEncounter(link.clinicId, e);
    }
    for await (const i of client.streamInvoices(sinceIso)) {
      yield normalizeInvoice(link.clinicId, i);
    }
    for await (const r of client.streamRecalls(sinceIso)) {
      yield normalizeRecall(link.clinicId, r);
    }
  },

  async poll(
    link: PvsLinkRow,
    cursor: string | null
  ): Promise<AdapterPollResult> {
    const client = TomedoClient.from(link);
    const cursors = parseCursor(cursor);
    const events: CanonicalEvent[] = [];

    const newCursors = { ...cursors };
    for await (const p of client.streamPatients(cursors.patients)) {
      events.push(normalizePatient(link.clinicId, p));
      newCursors.patients = pickMax(newCursors.patients, p.modifiedAt);
    }
    for await (const a of client.streamAppointments(cursors.appointments)) {
      events.push(normalizeAppointment(link.clinicId, a));
      newCursors.appointments = pickMax(newCursors.appointments, a.modifiedAt);
    }
    for await (const e of client.streamEncounters(cursors.encounters)) {
      events.push(normalizeEncounter(link.clinicId, e));
      newCursors.encounters = pickMax(newCursors.encounters, e.modifiedAt);
    }
    for await (const i of client.streamInvoices(cursors.invoices)) {
      events.push(normalizeInvoice(link.clinicId, i));
      newCursors.invoices = pickMax(newCursors.invoices, i.modifiedAt);
    }
    for await (const r of client.streamRecalls(cursors.recalls)) {
      events.push(normalizeRecall(link.clinicId, r));
      newCursors.recalls = pickMax(newCursors.recalls, r.modifiedAt);
    }

    return {
      events,
      nextCursor: serializeCursor(newCursors),
      // Empty poll? Back off to 5 min. Otherwise hit again in 60s.
      recommendedDelayMs: events.length === 0 ? 5 * 60_000 : 60_000,
    };
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
  return [c.patients, c.appointments, c.encounters, c.invoices, c.recalls].join(",");
}

function pickMax(a: string, b: string): string {
  return a >= b ? a : b;
}
