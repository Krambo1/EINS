import "server-only";
import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  RESPONSE_RULE_START,
  evaluateEnforcement,
  formatCureDeadline,
  toDeadlineRow,
  type DeadlineRow,
  type EnforcementEvent,
  type EnforcementKind,
  type EnforcementState,
} from "@/lib/response-time";
import { firstAttemptAtSql, toAttemptDate } from "@/server/queries/response-time";
import { responseRuleStartsByClinic } from "@/server/guarantee-clock";

/**
 * Admin-only reads for the Rückruf-Lage (Folge 3 of the 48-Werkstunden rule,
 * migration 0076). Superuser `db`: the events table has no eins_app grant and
 * the overview spans every Praxis. Rules live in lib/response-time.ts.
 */

type EventRow = typeof schema.responseEnforcementEvents.$inferSelect;

export interface RueckrufRow {
  clinicId: string;
  clinicName: string;
  state: EnforcementState;
  events: EventRow[];
}

function toEvent(e: EventRow): EnforcementEvent {
  return { kind: e.kind as EnforcementKind, occurredAt: e.occurredAt, requestIds: e.requestIds ?? [] };
}

/**
 * Inquiries that can matter for Folge 3: spam excluded, arrived after the
 * rule started (K-3: and after the Praxis signed, see `ruleStarts`), not
 * rejected on the Garantie-Uhr as a test entry (K-3), and either still
 * without attempt or attempted after `since` (needed to rebuild the overdue
 * count at a past cure deadline).
 */
async function deadlineRows(
  clinicIds: string[],
  since: Date,
  ruleStarts: Map<string, Date>
): Promise<Map<string, DeadlineRow[]>> {
  const out = new Map<string, DeadlineRow[]>();
  if (clinicIds.length === 0) return out;
  const r = schema.requests;
  const rows = await db
    .select({
      id: r.id,
      clinicId: r.clinicId,
      createdAt: r.createdAt,
      status: r.status,
      firstAttemptAt: firstAttemptAtSql(),
    })
    .from(r)
    .where(
      and(
        inArray(r.clinicId, clinicIds),
        ne(r.status, "spam"),
        gte(r.createdAt, RESPONSE_RULE_START),
        sql`NOT EXISTS (SELECT 1 FROM guarantee_candidate_rejections gcr
                         WHERE gcr.request_id = "requests"."id" AND gcr.reason = 'test_eintrag')`,
        or(sql`${firstAttemptAtSql()} IS NULL`, sql`${firstAttemptAtSql()} >= ${since.toISOString()}::timestamptz`)
      )
    );
  for (const row of rows) {
    const d = toDeadlineRow({
      ...row,
      firstAttemptAt: toAttemptDate(row.firstAttemptAt),
      ruleStart: ruleStarts.get(row.clinicId) ?? null,
    });
    if (!d) continue;
    const list = out.get(row.clinicId) ?? [];
    list.push(d);
    out.set(row.clinicId, list);
  }
  return out;
}

async function load(clinicFilter: string | null, now: Date): Promise<RueckrufRow[]> {
  const clinicsQuery = db
    .select({ id: schema.clinics.id, name: schema.clinics.displayName })
    .from(schema.clinics);
  const clinics = await (clinicFilter
    ? clinicsQuery.where(eq(schema.clinics.id, clinicFilter))
    : clinicsQuery.where(isNull(schema.clinics.archivedAt)).orderBy(asc(schema.clinics.displayName)));
  const ids = clinics.map((c) => c.id);
  if (ids.length === 0) return [];

  const events = await db
    .select()
    .from(schema.responseEnforcementEvents)
    .where(inArray(schema.responseEnforcementEvents.clinicId, ids))
    .orderBy(asc(schema.responseEnforcementEvents.occurredAt));
  const eventsBy = new Map<string, EventRow[]>();
  for (const e of events) {
    const list = eventsBy.get(e.clinicId) ?? [];
    list.push(e);
    eventsBy.set(e.clinicId, list);
  }

  // The earliest warning is the furthest back a past count is ever rebuilt.
  const warnings = events.filter((e) => e.kind === "warnung").map((e) => e.occurredAt.getTime());
  const since = new Date(Math.min(now.getTime(), ...warnings));
  const rowsBy = await deadlineRows(ids, since, await responseRuleStartsByClinic(ids));

  return clinics.map((c) => {
    const clinicEvents = eventsBy.get(c.id) ?? [];
    return {
      clinicId: c.id,
      clinicName: c.name,
      events: clinicEvents,
      state: evaluateEnforcement({
        rows: rowsBy.get(c.id) ?? [],
        events: clinicEvents.map(toEvent),
        now,
        formatDate: formatCureDeadline,
      }),
    };
  });
}

/** Every non-archived Praxis, most urgent first. */
export async function listRueckrufLage(now = new Date()): Promise<RueckrufRow[]> {
  const rows = await load(null, now);
  const rank = (r: RueckrufRow) =>
    r.state.resumeDue ? 0 : r.state.canPause ? 1 : r.state.paused ? 2 : r.state.canWarn ? 3 : 4;
  return rows.sort(
    (a, b) => rank(a) - rank(b) || b.state.overdueOpen.length - a.state.overdueOpen.length
  );
}

/** One Praxis, for the actions (archived ones included). */
export async function getRueckrufLage(clinicId: string, now = new Date()): Promise<RueckrufRow | null> {
  const [row] = await load(clinicId, now);
  return row ?? null;
}
