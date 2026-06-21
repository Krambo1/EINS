import "server-only";
import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { TimelineStatus } from "@/lib/constants";

/**
 * Default Fortschritt-Journey seeding.
 *
 * Every newly onboarded Praxis should open the Fortschritt tab and see a clear,
 * forward-looking plan instead of an empty tab. The plan lives in the central,
 * admin-editable `timeline_default_steps` template; this helper COPIES it into a
 * clinic's own `clinic_timeline_entries` feed (relative phases, event_date NULL,
 * status from the template's default_status).
 *
 * Called from:
 *   - the admin "Standard-Journey einsetzen" button (empty/existing clinics), and
 *   - any clinic-creation path that wants the journey from day one.
 *
 * Runs on the superuser `db` connection because `timeline_default_steps` has no
 * `eins_app` GRANT (the template is global EINS content, never exposed to the
 * clinic-facing role; clinics only ever see their own seeded copies).
 */

/** Author stamped on seeded entries — reads as "EINS", not a personal address. */
export const DEFAULT_JOURNEY_CREATED_BY = "team@eins.ag";

/**
 * Copy the active default-journey steps into a clinic's Fortschritt feed.
 *
 * Idempotent: seeds ONLY when the clinic currently has zero timeline entries, so
 * a re-click, a re-onboard, or an auto-seed colliding with a manual click never
 * duplicates, and a clinic that already has its own entries (e.g. the demo
 * clinic's dated showcase) is left untouched. A per-clinic advisory lock
 * serialises concurrent calls so the empty-check and the insert cannot race.
 *
 * @returns number of steps seeded (0 when skipped because entries already exist).
 */
export async function applyDefaultJourney(
  clinicId: string
): Promise<{ seeded: number }> {
  return await db.transaction(async (tx) => {
    // Serialise concurrent seeds for THIS clinic: two admins clicking at once,
    // or an auto-seed racing a manual click, can't both pass the empty-check.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('eins:journey:' || ${clinicId}))`
    );

    const inserted = (await tx.execute(sql`
      INSERT INTO clinic_timeline_entries (
        clinic_id, title, description, phase_label, sort_order, status, created_by_email
      )
      SELECT
        ${clinicId}, title, description, phase_label, sort_order, default_status,
        ${DEFAULT_JOURNEY_CREATED_BY}
      FROM timeline_default_steps
      WHERE is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM clinic_timeline_entries WHERE clinic_id = ${clinicId}
        )
      ORDER BY sort_order
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    return { seeded: inserted.length };
  });
}

/** One row of the central default-journey template, for the admin editor. */
export interface DefaultJourneyStep {
  id: string;
  sortOrder: number;
  phaseLabel: string | null;
  title: string;
  description: string | null;
  defaultStatus: TimelineStatus;
  isActive: boolean;
}

/**
 * Read every default-journey step (active and inactive) in plan order, for the
 * admin template editor. Superuser `db` — the template has no `eins_app` grant.
 */
export async function listDefaultJourneySteps(): Promise<DefaultJourneyStep[]> {
  const rows = await db
    .select()
    .from(schema.timelineDefaultSteps)
    .orderBy(asc(schema.timelineDefaultSteps.sortOrder));

  return rows.map((r) => ({
    id: r.id,
    sortOrder: r.sortOrder,
    phaseLabel: r.phaseLabel,
    title: r.title,
    description: r.description,
    defaultStatus: r.defaultStatus as TimelineStatus,
    isActive: r.isActive,
  }));
}
