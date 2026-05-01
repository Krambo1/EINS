import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";

/**
 * Reputation helpers — Detail-mode reviews card. The reviews table holds
 * per-platform snapshots logged manually from /einstellungen.
 */

export interface ReviewSnapshot {
  id: string;
  platform: "google" | "jameda" | "trustpilot" | "manual";
  rating: number;
  totalCount: number;
  recordedAt: Date;
  notes: string | null;
}

/** Most-recent snapshot per platform. */
export async function latestReviews(
  clinicId: string,
  userId: string
): Promise<ReviewSnapshot[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT ON (platform)
        id, platform, rating, total_count, recorded_at, notes
      FROM reviews
      WHERE clinic_id = ${clinicId}
      ORDER BY platform, recorded_at DESC
    `);
    return (rows as unknown as Array<{
      id: string;
      platform: string;
      rating: string;
      total_count: number;
      recorded_at: Date;
      notes: string | null;
    }>).map((r) => ({
      id: r.id,
      platform: r.platform as ReviewSnapshot["platform"],
      rating: Number(r.rating),
      totalCount: Number(r.total_count),
      recordedAt: r.recorded_at,
      notes: r.notes,
    }));
  });
}

export interface ReviewTrendRow {
  platform: string;
  rating: number;
  recordedAt: Date;
}

/** Trend over the last N months. Multiple rows per platform. */
export async function reviewTrend(
  clinicId: string,
  userId: string,
  months = 6
): Promise<ReviewTrendRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const rows = await tx
      .select({
        platform: schema.reviews.platform,
        rating: schema.reviews.rating,
        recordedAt: schema.reviews.recordedAt,
      })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.clinicId, clinicId),
          gte(schema.reviews.recordedAt, since)
        )
      )
      .orderBy(schema.reviews.platform, schema.reviews.recordedAt);
    return rows.map((r) => ({
      platform: r.platform,
      rating: Number(r.rating),
      recordedAt: r.recordedAt,
    }));
  });
}

/** Full reviews list — admin-style page in /einstellungen. */
export async function listReviews(
  clinicId: string,
  userId: string
): Promise<
  Array<{
    id: string;
    platform: string;
    rating: number;
    totalCount: number;
    periodStart: string | null;
    periodEnd: string | null;
    recordedAt: Date;
    notes: string | null;
  }>
> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.clinicId, clinicId))
      .orderBy(desc(schema.reviews.recordedAt));
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      rating: Number(r.rating),
      totalCount: Number(r.totalCount),
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      recordedAt: r.recordedAt,
      notes: r.notes,
    }));
  });
}
