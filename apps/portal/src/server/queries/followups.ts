import "server-only";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { FollowupStatus } from "@/lib/constants";

/**
 * Read helpers for Wiedervorlagen (request_followups).
 *
 * Portal-native, pre-booking phase only — see anfragen/[id]/actions.ts for
 * the PVS boundary. All calls run inside withClinicContext → RLS-enforced.
 */

export interface FollowupRow {
  id: string;
  requestId: string;
  dueAt: Date;
  note: string | null;
  status: FollowupStatus;
  createdByName: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

/**
 * All Wiedervorlagen for one request: pending first (soonest due at top),
 * then resolved history (most recently created first). Drives the
 * <Followups> list and the "nächste Wiedervorlage" proof line on the detail
 * page.
 */
export async function listFollowupsForRequest(
  clinicId: string,
  userId: string,
  requestId: string
): Promise<FollowupRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.requestFollowups.id,
        requestId: schema.requestFollowups.requestId,
        dueAt: schema.requestFollowups.dueAt,
        note: schema.requestFollowups.note,
        status: schema.requestFollowups.status,
        createdByName: schema.clinicUsers.fullName,
        completedAt: schema.requestFollowups.completedAt,
        createdAt: schema.requestFollowups.createdAt,
      })
      .from(schema.requestFollowups)
      .leftJoin(
        schema.clinicUsers,
        eq(schema.requestFollowups.createdBy, schema.clinicUsers.id)
      )
      .where(
        and(
          eq(schema.requestFollowups.requestId, requestId),
          eq(schema.requestFollowups.clinicId, clinicId)
        )
      )
      // Pending before resolved; within pending soonest-due first; resolved
      // history newest-first. One ORDER BY expresses all three.
      .orderBy(
        sql`(${schema.requestFollowups.status} = 'pending') DESC`,
        sql`CASE WHEN ${schema.requestFollowups.status} = 'pending'
              THEN ${schema.requestFollowups.dueAt} END ASC`,
        desc(schema.requestFollowups.createdAt)
      );

    return rows.map((r) => ({ ...r, status: r.status as FollowupStatus }));
  });
}

export interface DueFollowup {
  id: string;
  requestId: string;
  dueAt: Date;
  note: string | null;
  contactName: string | null;
}

/**
 * Clinic-wide list of pending Wiedervorlagen that are due now (due_at <= now()),
 * soonest first. Backs the "fällige Wiedervorlagen zuerst" prioritisation in
 * the call queue. Hits request_followups_due_idx (clinic_id, status, due_at).
 */
export async function dueFollowups(
  clinicId: string,
  userId: string
): Promise<DueFollowup[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    return tx
      .select({
        id: schema.requestFollowups.id,
        requestId: schema.requestFollowups.requestId,
        dueAt: schema.requestFollowups.dueAt,
        note: schema.requestFollowups.note,
        contactName: schema.requests.contactName,
      })
      .from(schema.requestFollowups)
      .innerJoin(
        schema.requests,
        eq(schema.requestFollowups.requestId, schema.requests.id)
      )
      .where(
        and(
          eq(schema.requestFollowups.clinicId, clinicId),
          eq(schema.requestFollowups.status, "pending"),
          lte(schema.requestFollowups.dueAt, sql`now()`)
        )
      )
      .orderBy(asc(schema.requestFollowups.dueAt));
  });
}
