import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { applyPvsEvent, type PvsEvent } from "@/server/pvs-events";

/**
 * P1-2: pvs_link state machine transitions.
 *
 * Today the only operator-driven transition we expose is pending →
 * connected via confirmPvsLinkActive(). The state graph in full:
 *
 *   unconfigured  ─── (enrollment redeem) ───────────►  connected
 *   akkreditierung                                            ▲
 *   pending      ─── (confirmPvsLinkActive) ──────────────────┘
 *   connected    ─── (admin disable) ────────────────►  disconnected
 *   *            ─── (adapter error) ────────────────►  error
 *
 * The pending → connected path is the one that needs careful handling
 * because events ingested while the link was 'pending' have been
 * persisted to pvs_event_log with applied_at = NULL and
 * link_status_at_ingest = 'pending'. confirmPvsLinkActive() flips the
 * link status AND replays every quarantined event through the regular
 * applyPvsEvent pipeline so the linker + derive worker run as if the
 * event had arrived after confirmation.
 *
 * Idempotency: confirmPvsLinkActive() on an already-connected link is
 * a no-op (it returns { replayed: 0 } without writing). Concurrent
 * confirmations are serialised by the database's UPDATE … WHERE
 * status = 'pending' conditional — only the first wins.
 */

export type ConfirmResult =
  | { ok: true; replayed: number; alreadyActive: boolean }
  | { ok: false; reason: "link_not_found" | "wrong_status" | "internal_error" };

export async function confirmPvsLinkActive(input: {
  clinicId: string;
  actorUserId: string | null;
  /**
   * Optional bounded retry on the replay loop. Events that fail their
   * linker/derive on the first attempt stay un-applied so a future
   * replay (or a manual reconciliation) can retry. The default replays
   * the first 10,000 oldest pending events in one call — enough for the
   * common case of a clinic that's been ingesting for a day or two
   * while waiting for operator confirmation, small enough to keep the
   * confirmation call bounded.
   */
  replayBatchSize?: number;
}): Promise<ConfirmResult> {
  const batchSize = input.replayBatchSize ?? 10_000;

  // 1) Resolve current link state. If it's already connected, return
  //    early without writing — operator may have double-clicked.
  const [link] = await db
    .select({
      id: schema.pvsLink.id,
      status: schema.pvsLink.status,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, input.clinicId))
    .limit(1);
  if (!link) return { ok: false, reason: "link_not_found" };
  if (link.status === "connected") {
    return { ok: true, replayed: 0, alreadyActive: true };
  }
  if (link.status !== "pending") {
    return { ok: false, reason: "wrong_status" };
  }

  // 2) Transition in a transaction so the audit row is atomic with the
  //    status flip. The conditional WHERE status='pending' serialises
  //    concurrent confirmations: only the first commits.
  const flipped = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.pvsLink)
      .set({ status: "connected", updatedAt: new Date() })
      .where(
        and(
          eq(schema.pvsLink.id, link.id),
          eq(schema.pvsLink.status, "pending")
        )
      )
      .returning({ id: schema.pvsLink.id });
    if (updated.length === 0) {
      // Lost the race — somebody else just confirmed.
      return false;
    }
    await tx.insert(schema.pvsLinkAudit).values({
      clinicId: input.clinicId,
      kind: "status_change",
      fromValue: "pending",
      toValue: "connected",
      context: { trigger: "confirmPvsLinkActive" },
      actorUserId: input.actorUserId,
    });
    return true;
  });
  if (!flipped) {
    // Treat lost-race as "already active" — the other caller did the
    // work; we don't double-replay.
    return { ok: true, replayed: 0, alreadyActive: true };
  }

  // 3) Replay quarantined events for this clinic, oldest first. We use
  //    the partial index pvs_event_log_pending_replay_idx (migration
  //    0045) for fast lookup. Each row's payload is the canonical event;
  //    we just re-invoke applyPvsEvent.
  //
  //    Critical: between this query and the apply, the link is already
  //    'connected', so applyPvsEvent's link.status check passes and the
  //    event hits the full linker + derive path. The pvs_event_log row
  //    is deduped on (clinic_id, bridge_source, pvs_external_event_id,
  //    occurred_at) by the existing UNIQUE constraint — re-applying via
  //    applyPvsEvent results in a 'deduped' return; we still mark
  //    applied_at via markEventApplied (handled inline below since
  //    that helper isn't exported).
  //
  //    Why not extract applyEventEffects(): cleanly separating linker +
  //    derive from event_log insert is a bigger refactor than P1-2
  //    needs. The dedupe-on-replay path is correct and idempotent.
  let replayed = 0;
  try {
    const rows = await db
      .select({
        id: schema.pvsEventLog.id,
        payload: schema.pvsEventLog.payload,
      })
      .from(schema.pvsEventLog)
      .where(
        and(
          eq(schema.pvsEventLog.clinicId, input.clinicId),
          eq(schema.pvsEventLog.linkStatusAtIngest, "pending"),
          isNull(schema.pvsEventLog.appliedAt)
        )
      )
      .orderBy(asc(schema.pvsEventLog.occurredAt))
      .limit(batchSize);

    for (const row of rows) {
      // applyPvsEvent dedupes on the UNIQUE index — re-applying after the
      // event_log INSERT is safe. The linker + derive run; the
      // event_log insert returns 'deduped' but we don't care about that
      // status here, only the side effects. After it returns, mark
      // applied_at so subsequent confirmations don't re-pick this row.
      try {
        await applyPvsEvent(row.payload as PvsEvent);
      } catch (err) {
        console.error(
          `[pvs-link-state] replay applyPvsEvent threw for eventLogId=${row.id}:`,
          err
        );
        // Don't mark applied — leave the row eligible for retry. The
        // operator gets a partial replay count in the response.
        continue;
      }
      await db
        .update(schema.pvsEventLog)
        .set({ appliedAt: new Date() })
        .where(eq(schema.pvsEventLog.id, row.id));
      replayed += 1;
    }
  } catch (err) {
    console.error("[pvs-link-state] replay loop failed:", err);
    // Status is already flipped; partial replay is acceptable. Surface
    // success with the count so the caller knows some events landed.
    return { ok: true, replayed, alreadyActive: false };
  }

  return { ok: true, replayed, alreadyActive: false };
}

/**
 * Count how many events are currently quarantined under a pending link.
 * Used by the operator dashboard banner ("X events waiting to be
 * applied — confirm the link to release them").
 */
export async function countQuarantinedEvents(
  clinicId: string
): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
    })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, clinicId),
        eq(schema.pvsEventLog.linkStatusAtIngest, "pending"),
        isNull(schema.pvsEventLog.appliedAt)
      )
    );
  return row?.n ?? 0;
}
