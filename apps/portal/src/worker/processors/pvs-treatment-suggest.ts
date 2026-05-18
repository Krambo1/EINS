import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * Daily auto-mapping suggester for pvs_treatment_mapping.
 *
 * For each unmapped PVS treatment, compute the trigram similarity between
 * its `pvs_label` and the keyword list of every active treatment in the
 * clinic. If similarity ≥ THRESHOLD, store the best match as
 * `suggested_treatment_id` + `suggested_score`. The mapping page renders
 * suggestions with a ★ marker so the inhaber can one-click accept.
 */

const THRESHOLD = 0.4;

export interface PvsTreatmentSuggestJob {
  clinicId?: string;
}

export async function processPvsTreatmentSuggest(
  job: PvsTreatmentSuggestJob = {}
): Promise<void> {
  const unmapped = await db
    .select({
      id: schema.pvsTreatmentMapping.id,
      clinicId: schema.pvsTreatmentMapping.clinicId,
      label: schema.pvsTreatmentMapping.pvsLabel,
    })
    .from(schema.pvsTreatmentMapping)
    .where(
      and(
        eq(schema.pvsTreatmentMapping.status, "unmapped"),
        ...(job.clinicId
          ? [eq(schema.pvsTreatmentMapping.clinicId, job.clinicId)]
          : [])
      )
    );

  for (const u of unmapped) {
    if (!u.label) continue;
    const candidates = await db.execute<{
      id: string;
      score: number;
    }>(sql`
      SELECT t.id, similarity(coalesce(t.keywords, '') || ' ' || t.name, ${u.label}) AS score
      FROM treatments t
      WHERE t.clinic_id = ${u.clinicId}
        AND t.archived_at IS NULL
      ORDER BY score DESC
      LIMIT 1
    `);
    const best = (candidates as unknown as Array<{ id: string; score: number }>)[0];
    if (best && best.score >= THRESHOLD) {
      await db
        .update(schema.pvsTreatmentMapping)
        .set({
          suggestedTreatmentId: best.id,
          suggestedScore: best.score.toFixed(2),
        })
        .where(eq(schema.pvsTreatmentMapping.id, u.id));
    }
  }
}
