import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { withClinicContext, schema } from "@/db/client";
import { sectionBadgeThreshold } from "./navBadges";

export type TimelineEntry = typeof schema.clinicTimelineEntries.$inferSelect;

async function fetchTimelineEntries(
  clinicId: string,
  userId: string
): Promise<TimelineEntry[]> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) =>
      tx
        .select()
        .from(schema.clinicTimelineEntries)
        .orderBy(desc(schema.clinicTimelineEntries.eventDate)),
    "timeline:list"
  );
}

/**
 * Returns true iff any timeline entry has been touched since this user's
 * own last visit to /fortschritt — i.e. a new entry was added or an
 * existing entry's status moved (geplant → laeuft → abgeschlossen) after
 * their last view. Drives the sidebar Fortschritt "Neu" pill.
 *
 * For users who have never visited the section, the threshold falls back
 * to a 14-day lookback (see `sectionBadgeThreshold`) so the badge only
 * surfaces actually-recent activity instead of every historical entry.
 */
export async function hasRecentTimelineUpdate(
  clinicId: string,
  userId: string
): Promise<boolean> {
  const threshold = await sectionBadgeThreshold(clinicId, userId, "fortschritt");
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx
        .select({ id: schema.clinicTimelineEntries.id })
        .from(schema.clinicTimelineEntries)
        .where(
          and(
            eq(schema.clinicTimelineEntries.clinicId, clinicId),
            gt(schema.clinicTimelineEntries.updatedAt, threshold)
          )
        )
        .limit(1),
    "timeline:has-recent"
  );
  return rows.length > 0;
}

export async function getTimelineEntries(
  clinicId: string,
  userId: string
): Promise<TimelineEntry[]> {
  const rows = await unstable_cache(
    () => fetchTimelineEntries(clinicId, userId),
    ["timeline-entries", clinicId],
    {
      tags: [`timeline:${clinicId}`],
      revalidate: 300,
    }
  )();
  // unstable_cache JSON-serializes its result, so Date columns come back as
  // ISO strings on a cache hit. Revive them so the TimelineEntry contract holds.
  return rows.map((r) => ({
    ...r,
    eventDate: new Date(r.eventDate),
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}
