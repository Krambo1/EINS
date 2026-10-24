import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ALL_REQUEST_STATUSES, type AnyRequestStatus } from "@/lib/constants";
import type { RejectionReason } from "@/lib/guarantee-clock";

/**
 * D6 (Karam 2026-10-08): an inquiry the admin rejects as "Test der EINS-Seite"
 * (`test_eintrag`) is also set to "spam", so the Praxis no longer sees it as
 * unanswered (KANON 6a: spam does not count as "nicht beantwortet" and not
 * toward the 3-open-Anfragen rule). Undoing the rejection restores the
 * previous status, but only while nobody changed the status in between.
 *
 * Both helpers run inside the caller's transaction (superuser `db`, the
 * admin is no clinic user, so `actor_id` stays NULL like PVS rows; the admin
 * is named in the guarantee audit row). The activity carries the same
 * `meta.from` / `meta.to` shape as every other status change, which the
 * Verlauf, forecast and KPI reconstruction read.
 */

/** Marks the status_change written by the rejection, so the undo finds it. */
export const TEST_SPAM_VIA = "garantie_test";
/** Marks the status_change written by the undo. */
export const TEST_SPAM_UNDO_VIA = "garantie_test_undo";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isStatus(v: unknown): v is AnyRequestStatus {
  return typeof v === "string" && (ALL_REQUEST_STATUSES as readonly string[]).includes(v);
}

/** Pure: does this rejection also set the inquiry to spam? */
export function shouldMarkSpam(reason: RejectionReason, currentStatus: string): boolean {
  return reason === "test_eintrag" && currentStatus !== "spam";
}

export type RestorePlan =
  | { restore: AnyRequestStatus }
  | { keep: "kein_test" | "kein_spam" | "status_geaendert" | "vorheriger_status_unbekannt" };

/**
 * Pure: what the undo of a rejection does with the inquiry status. Restores
 * only when the rejection was a test, the inquiry is still spam and its latest
 * status change is the one the rejection wrote.
 */
export function restorePlan(input: {
  reason: string;
  currentStatus: string;
  latestChangeMeta: unknown;
}): RestorePlan {
  if (input.reason !== "test_eintrag") return { keep: "kein_test" };
  if (input.currentStatus !== "spam") return { keep: "kein_spam" };
  const meta =
    !!input.latestChangeMeta && typeof input.latestChangeMeta === "object"
      ? (input.latestChangeMeta as Record<string, unknown>)
      : null;
  if (!meta || meta.via !== TEST_SPAM_VIA || meta.to !== "spam") return { keep: "status_geaendert" };
  if (!isStatus(meta.from) || meta.from === "spam") return { keep: "vorheriger_status_unbekannt" };
  return { restore: meta.from };
}

async function lockedStatus(tx: Tx, clinicId: string, requestId: string): Promise<string | null> {
  const [row] = await tx
    .select({ status: schema.requests.status })
    .from(schema.requests)
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.clinicId, clinicId)))
    .limit(1)
    .for("update");
  return row?.status ?? null;
}

async function setStatus(
  tx: Tx,
  clinicId: string,
  requestId: string,
  from: string,
  to: AnyRequestStatus,
  via: string
): Promise<void> {
  await tx
    .update(schema.requests)
    .set({ status: to, statusSource: "manual" })
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.clinicId, clinicId)));
  await tx.insert(schema.requestActivities).values({
    requestId,
    actorId: null,
    kind: "status_change",
    meta: { from, to, via },
    // Wall clock, not the transaction start, so two changes in one
    // transaction still order correctly for "latest status change".
    createdAt: new Date(),
  });
}

/**
 * Step 1 of D6. Returns the status before, or null when nothing changed
 * (not a test rejection, already spam, request gone).
 */
export async function markTestInquiryAsSpam(
  tx: Tx,
  args: { clinicId: string; requestId: string; reason: RejectionReason }
): Promise<{ statusBefore: string } | null> {
  if (args.reason !== "test_eintrag") return null;
  const status = await lockedStatus(tx, args.clinicId, args.requestId);
  if (status === null || !shouldMarkSpam(args.reason, status)) return null;
  await setStatus(tx, args.clinicId, args.requestId, status, "spam", TEST_SPAM_VIA);
  return { statusBefore: status };
}

/** Step 2 of D6: run after the rejection row was deleted. */
export async function restoreTestInquiryStatus(
  tx: Tx,
  args: { clinicId: string; requestId: string; reason: string }
): Promise<RestorePlan> {
  if (args.reason !== "test_eintrag") return { keep: "kein_test" };
  const status = await lockedStatus(tx, args.clinicId, args.requestId);
  if (status === null) return { keep: "kein_spam" };
  const [latest] = await tx
    .select({ meta: schema.requestActivities.meta })
    .from(schema.requestActivities)
    .where(
      and(
        eq(schema.requestActivities.requestId, args.requestId),
        eq(schema.requestActivities.kind, "status_change")
      )
    )
    .orderBy(desc(schema.requestActivities.createdAt), desc(schema.requestActivities.id))
    .limit(1);
  const plan = restorePlan({ reason: args.reason, currentStatus: status, latestChangeMeta: latest?.meta });
  if ("restore" in plan) {
    await setStatus(tx, args.clinicId, args.requestId, "spam", plan.restore, TEST_SPAM_UNDO_VIA);
  }
  return plan;
}
