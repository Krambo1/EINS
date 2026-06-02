/**
 * Tomedo event-identity contract (Phase 11 cross-path dedup).
 *
 * The SINGLE source of truth for how a Tomedo event is identified, so the
 * portal's cross-path dedup actually collapses the same logical event no
 * matter which path produced it.
 *
 * The portal dedups on the UNIQUE index
 *   (clinic_id, bridge_source, pvs_external_event_id, occurred_at).
 * For two paths to dedup, ALL FOUR columns must be byte-identical for the same
 * logical event. bridge_source is always "tomedo"; this module pins the other
 * two (id template + the occurred_at value).
 *
 * Conforming paths (these DO dedup against each other):
 *   - REST adapter: apps/bridge/src/adapters/tomedo/normalize.ts (imports this).
 *   - DB-read YAML: apps/bridge/agent/src/db-adapters/configs/tomedo.yaml. It is
 *     declarative, so it cannot import this module; the agent test
 *     cross-path-dedup.test.ts pins its id templates + occurred_at sources to
 *     the exact strings produced here, with the same fixed fixture.
 *
 * Deliberately NON-conforming (separate provenance, do NOT co-run with the
 * above):
 *   - Lua hooks: apps/portal/public/pvs-bridge/tomedo-lua/hooks/*.lua. Lua fires
 *     on Tomedo workflow triggers and, for a status change, only knows the
 *     hook-fire time (os.time()), never the row's modified_at. So it cannot
 *     reproduce occurred_at for every kind. It keeps the distinct "tomedo-lua:"
 *     id prefix on purpose: aligning only the prefix would dedup invoices but
 *     double-count status changes (a partial-dedup bug). Lua is a liveness
 *     fallback; run exactly one of {Lua, DB-read} per Praxis.
 *
 * Timestamp rule: every timestamp that lands in an id or in occurred_at goes
 * through isoUtc() (== `new Date(x).toISOString()`). The DB-read path emits the
 * exact same string for the same underlying Tomedo value: its isoDateTime
 * transform and its template coercion (coerceScalar) both call
 * Date.prototype.toISOString(). So a REST poll and a DB-read poll of the same
 * Tomedo row yield identical (id, occurred_at), and the unique index collapses
 * them. (Both paths read Tomedo's stored timestamp; if the REST API ever
 * returned a coarser precision than the DB column for the same field, only that
 * field's dedup would weaken. Operationally REST and DB-read are not both run
 * for one Tomedo Praxis, so this is a contract guarantee, not a hot path.)
 */

/**
 * Normalise a timestamp string to canonical ISO-8601 UTC. Returns the input
 * unchanged when it cannot be parsed (so the portal Zod surfaces the bad value
 * rather than this silently dropping it), and "" for empty/nullish input.
 */
export function isoUtc(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/**
 * pvsExternalEventId builders, one per Tomedo event kind. Kinds whose id embeds
 * a timestamp (patient, appointment-status, refund) take the ALREADY isoUtc()-
 * normalised value so the id matches the DB-read template byte-for-byte.
 */
export const tomedoEventId = {
  patient: (id: string, modifiedAtIso: string): string =>
    `tomedo:patient:${id}:${modifiedAtIso}`,
  appointment: (id: string): string => `tomedo:appointment:${id}`,
  appointmentStatus: (id: string, status: string, modifiedAtIso: string): string =>
    `tomedo:appointment-status:${id}:${status}:${modifiedAtIso}`,
  encounter: (id: string): string => `tomedo:encounter:${id}`,
  invoice: (id: string): string => `tomedo:invoice:${id}`,
  recall: (id: string): string => `tomedo:recall:${id}`,
  refund: (id: string, modifiedAtIso: string): string =>
    `tomedo:refund:${id}:${modifiedAtIso}`,
} as const;
