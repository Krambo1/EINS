import "server-only";
import { desc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { withClinicContext, schema } from "@/db/client";

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
    // Nullable since 0063 (relative-phase steps carry phase_label, no date).
    // Guard the revival so a null date stays null instead of becoming epoch.
    eventDate: r.eventDate ? new Date(r.eventDate) : null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}
