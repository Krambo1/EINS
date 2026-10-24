/**
 * Messwege Anruf and Buchung against a REAL local Postgres (migration 0098):
 * a call on an assigned tracking number creates an Anfrage with source
 * 'anruf' and Messweg confidence, a replay of the same delivery changes
 * nothing, the same caller within 30 days becomes an activity, a booking
 * starts as "Termin vereinbart", an unassigned number is logged without a
 * Praxis, and the Garantie-Uhr proposes the call as a candidate.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   MESSWEG_DB_TEST=1 npx vitest run src/server/messweg/ingest.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { MesswegEvent } from "@/lib/messweg";

const enabled = process.env.MESSWEG_DB_TEST === "1";

describe.skipIf(!enabled)("ingestMesswegEvent (local DB)", () => {
  it("creates, replays, merges and books", async () => {
    delete process.env.OPENAI_API_KEY;
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { ingestMesswegEvent } = await import("./ingest");
    const { eraseClinicData } = await import("../dsgvo");
    const { eligibleInquiries } = await import("@/lib/guarantee-clock");

    const clinicId = randomUUID();
    const slug = `messweg-test-${clinicId.slice(0, 8)}`;
    const number = `+49221${Math.floor(1e6 + Math.random() * 8e6)}`;
    const ref = `https://api.calendly.com/event_types/${clinicId}`;
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'Messweg Test', 'Messweg Test', ${slug})`);
    await db.execute(sql`INSERT INTO tracking_numbers (clinic_id, e164, channel, provider)
      VALUES (${clinicId}, ${number}, 'profil', 'fixture')`);
    await db.execute(sql`INSERT INTO booking_links (clinic_id, provider, url, external_ref, medium)
      VALUES (${clinicId}, 'fixture', 'https://calendly.com/eins-test/beratung', ${ref}, 'dm')`);
    const ids: string[] = [];
    try {
      const call = (externalId: string, phone: string): MesswegEvent => ({
        kind: "anruf",
        provider: "fixture",
        externalId,
        occurredAt: new Date(),
        contactName: null,
        contactEmail: null,
        contactPhone: phone,
        utm: {},
        calledNumber: number,
        durationSec: 31,
        callStatus: "angenommen",
      });

      const first = await ingestMesswegEvent(call(`c1-${clinicId}`, "+491711112222"));
      expect(first).toMatchObject({ outcome: "angelegt", clinicId, replay: false });
      ids.push(`c1-${clinicId}`);
      const [req] = (await db.execute(sql`
        SELECT source, attribution_confidence, status, tracking_number_id IS NOT NULL AS has_number, utm
        FROM requests WHERE id = ${first.requestId}`)) as unknown as Array<Record<string, unknown>>;
      expect(req).toMatchObject({ source: "anruf", attribution_confidence: "messweg", status: "neu", has_number: true });
      expect(req!.utm).toEqual({ utm_source: "instagram", utm_medium: "profil_link" });

      const replay = await ingestMesswegEvent(call(`c1-${clinicId}`, "+491711112222"));
      expect(replay).toMatchObject({ replay: true, requestId: first.requestId });

      const again = await ingestMesswegEvent(call(`c2-${clinicId}`, "0171 1112222"));
      ids.push(`c2-${clinicId}`);
      expect(again).toMatchObject({ outcome: "zusammengefasst", requestId: first.requestId });
      const [counts] = (await db.execute(sql`
        SELECT (SELECT count(*)::int FROM requests WHERE clinic_id = ${clinicId}) AS requests,
               (SELECT count(*)::int FROM request_activities WHERE request_id = ${first.requestId} AND kind = 'messweg') AS merged
      `)) as unknown as Array<{ requests: number; merged: number }>;
      expect(counts).toEqual({ requests: 1, merged: 1 });

      const booking = await ingestMesswegEvent({
        kind: "buchung",
        provider: "fixture",
        externalId: `b1-${clinicId}`,
        occurredAt: new Date(),
        contactName: "Anna",
        contactEmail: `anna-${clinicId.slice(0, 8)}@example.test`,
        contactPhone: null,
        utm: { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" },
        bookingRef: ref,
        appointmentAt: new Date("2026-12-01T09:00:00Z"),
      });
      ids.push(`b1-${clinicId}`);
      expect(booking.outcome).toBe("angelegt");
      const [b] = (await db.execute(sql`
        SELECT source, status, appointment_at, attribution_confidence FROM requests WHERE id = ${booking.requestId}`)) as unknown as Array<Record<string, unknown>>;
      expect(b).toMatchObject({ source: "buchung", status: "termin_vereinbart", attribution_confidence: "messweg" });

      const orphanEvent = call(`c3-${clinicId}`, "+491719999999");
      if (orphanEvent.kind === "anruf") orphanEvent.calledNumber = "+4930999999999";
      const orphan = await ingestMesswegEvent(orphanEvent);
      ids.push(`c3-${clinicId}`);
      expect(orphan).toMatchObject({ outcome: "ohne_praxis", clinicId: null, requestId: null });

      // A claim left 'in_arbeit' by a run that died: a fresh one makes the
      // retry wait (busy), a stale one is taken over and processed.
      const { MesswegBusyError } = await import("./ingest");
      const stuck = call(`c4-${clinicId}`, "+491714444444");
      ids.push(`c4-${clinicId}`);
      await db.execute(sql`INSERT INTO messweg_events (provider, external_id, kind, outcome, occurred_at)
        VALUES ('fixture', ${`c4-${clinicId}`}, 'anruf', 'in_arbeit', now())`);
      await expect(ingestMesswegEvent(stuck)).rejects.toBeInstanceOf(MesswegBusyError);
      await db.execute(sql`UPDATE messweg_events SET received_at = now() - interval '10 minutes'
        WHERE provider = 'fixture' AND external_id = ${`c4-${clinicId}`}`);
      const takenOver = await ingestMesswegEvent(stuck);
      expect(takenOver).toMatchObject({ outcome: "angelegt", clinicId, replay: false });
      const [ev] = (await db.execute(sql`
        SELECT outcome, request_id FROM messweg_events
        WHERE provider = 'fixture' AND external_id = ${`c4-${clinicId}`}`)) as unknown as Array<Record<string, unknown>>;
      expect(ev).toMatchObject({ outcome: "angelegt", request_id: takenOver.requestId });

      const rows = (await db.execute(sql`
        SELECT id, created_at, source, utm, contact_email, contact_phone, status
        FROM requests WHERE clinic_id = ${clinicId}`)) as unknown as Array<Record<string, unknown>>;
      // Berlin calendar day (the Garantie-Uhr's day), not UTC: around midnight they differ.
      const today = (await import("@/lib/guarantee-clock")).berlinDate(new Date());
      const eligible = eligibleInquiries(
        rows.map((r) => ({
          id: String(r.id),
          createdAt: new Date(String(r.created_at)),
          source: String(r.source),
          utm: r.utm,
          contactEmail: r.contact_email as string | null,
          contactPhone: r.contact_phone as string | null,
          status: String(r.status),
        })),
        { signedOn: "2026-01-01", deadline: today, rejectedIds: new Set() }
      );
      expect(eligible.map((e) => e.attribution.messweg).sort()).toEqual(["anruf", "anruf", "buchung"]);
    } finally {
      await db.execute(sql`DELETE FROM messweg_events WHERE provider = 'fixture' AND external_id = ANY(${sql.param(ids)}::text[])`);
      await eraseClinicData(clinicId, { email: "messweg@example.test", slug, displayName: "Messweg Test" });
      await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${clinicId}`);
    }
  }, 60_000);
});
