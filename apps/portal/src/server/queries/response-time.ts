import "server-only";
import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { countResponseStates, type ResponseCounts } from "@/lib/response-time";
import { FRONT_DESK_SOURCES } from "@/lib/sources";

/**
 * First contact attempt of the Praxis per inquiry (Garantie-Anhang v2.1
 * § 2 Abs. (10)), as ONE SQL expression shared by every reader: Anfragen
 * list and detail, call queue, admin leads, Garantie-Uhr, Rückruf-Lage and
 * the monthly report.
 *
 * What counts, and where the portal writes it (verified against the code):
 *
 *   - `request_activities.kind = 'call'`: every "Anruf protokollieren"
 *     (logCall in anfragen/[id]/actions.ts), whatever the outcome
 *     (erreicht, nicht_erreicht, mailbox, falsche_nummer).
 *   - kind 'email' / 'whatsapp': "Nachricht protokollieren" (logMessage in
 *     anfragen/[id]/actions.ts).
 *   - kind 'status_change' with `meta->>'to'` not in spam / verloren / neu:
 *     changeStatus and logCall write `{from, to}`. "Kontaktiert", "Nicht
 *     erreicht" and "Termin vereinbart" count; later stages (Beratung
 *     erschienen, Gewonnen) imply contact and count too. Spam, Verloren and
 *     a step back to Neu do not.
 *   - kind 'status_change' with `meta->>'source' = 'pvs'`: the PVS derive
 *     worker (worker/processors/pvs-status-derive.ts, applyToRequest) writes
 *     this row (`derivedStatus`, and since pass 2 also `from`/`to`; rows
 *     written before carry no `to`) in the same step that
 *     books the status from a PVS appointment. Every derived status is a
 *     booking or later, so it is the "Terminbuchung über die PVS-Anbindung".
 *   - Front-desk entries (`source` in FRONT_DESK_SOURCES, "Anfrage anlegen"):
 *     the Praxis records a person it is already talking to (call or visit),
 *     so the entry itself is the contact and counts at `created_at`
 *     (reading of KANON 6a, 09.10.2026). Otherwise a walk-in would show as
 *     "von der Praxis nicht beantwortet" and count toward Folge 3.
 *   - Booking-link inquiries (`source` in BOOKING_SOURCES, Messweg "buchung"
 *     in lib/sources.ts): the inquiry IS the booking, so it counts at
 *     `created_at`. Written by the Messweg webhook (server/messweg/ingest.ts,
 *     source 'buchung'). Kind 'messweg' activities (the same person booked
 *     or called again) are NOT a contact attempt of the Praxis.
 *
 * Deliberately NOT used: `requests.first_contacted_at`. It means "first
 * actioned": changeStatus stamps it on neu→spam and neu→verloren too, and the
 * PVS worker never re-stamps it once set. Its PVS stamps always coincide with
 * the PVS status_change activity above (both written by applyToRequest since
 * the activity was added in May 2026), so it adds nothing but the wrong
 * spam/verloren timestamps.
 *
 * Postgres LEAST ignores NULLs, so the result is NULL only when no source
 * applies.
 */

export const BOOKING_SOURCES = ["buchung", "buchungslink", "booking", "booking_link"] as const;

const BOOKING_SOURCES_SQL = sql.raw(BOOKING_SOURCES.map((s) => `'${s}'`).join(", "));

const FRONT_DESK_SOURCES_SQL = sql.raw(FRONT_DESK_SOURCES.map((s) => `'${s}'`).join(", "));

/**
 * Correlated over the `requests` row in scope (the table must not be aliased).
 * Raw value: timestamptz or NULL.
 *
 * The outer columns are written fully qualified on purpose: in a single-table
 * select Drizzle renders `${schema.requests.id}` as a bare "id", which inside
 * the subquery would bind to request_activities.id instead.
 */
export function firstAttemptAtSql(): SQL<string | Date | null> {
  return sql<string | Date | null>`LEAST(
    (SELECT min(ra.created_at)
       FROM request_activities ra
      WHERE ra.request_id = "requests"."id"
        AND (
          ra.kind IN ('call', 'email', 'whatsapp')
          OR (
            ra.kind = 'status_change'
            AND (
              ra.meta->>'source' = 'pvs'
              OR ra.meta->>'to' NOT IN ('spam', 'verloren', 'neu')
            )
          )
        )),
    CASE WHEN "requests"."source" IN (${BOOKING_SOURCES_SQL}) THEN "requests"."created_at" END,
    CASE WHEN "requests"."source" IN (${FRONT_DESK_SOURCES_SQL}) THEN "requests"."created_at" END
  )`;
}

/**
 * Raw SQL values bypass Drizzle's column decoders (postgres-js hands back
 * timestamptz as a string), so every reader normalizes through this.
 */
export function toAttemptDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inquiries of one Praxis that arrived in [from, before), for the monthly report. */
export function responseRowsInPeriodQuery(clinicId: string, from: Date, before: Date) {
  const r = schema.requests;
  return db
    .select({
      createdAt: r.createdAt,
      status: r.status,
      firstAttemptAt: firstAttemptAtSql(),
    })
    .from(r)
    .where(and(eq(r.clinicId, clinicId), gte(r.createdAt, from), lt(r.createdAt, before)));
}

/** Folge 2 counts for the monthly report. Superuser handle (worker). */
export async function responseCountsForPeriod(
  clinicId: string,
  from: Date,
  before: Date,
  now: Date
): Promise<ResponseCounts> {
  // K-3: inquiries before the Praxis's signing date are outside the rule.
  // Dynamic import: server/guarantee-clock imports this module.
  const { responseRuleStartForClinic } = await import("@/server/guarantee-clock");
  const [rows, ruleStart] = await Promise.all([
    responseRowsInPeriodQuery(clinicId, from, before),
    responseRuleStartForClinic(clinicId),
  ]);
  return countResponseStates(
    rows.map((row) => ({
      createdAt: row.createdAt,
      status: row.status,
      firstAttemptAt: toAttemptDate(row.firstAttemptAt),
      ruleStart,
    })),
    now
  );
}
