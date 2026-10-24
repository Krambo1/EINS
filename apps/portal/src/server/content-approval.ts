import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, dbApp, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { checkHwg, type HwgFinding } from "@/server/hwg";
import { sendEmailOnce } from "@/server/email-once";
import { approvalBatchMail } from "@/server/email/templates/content-approval";
import { env } from "@/lib/env";
import { berlinDate, computeClock, formatIsoDate, type IsoDate } from "@/lib/guarantee-clock";
import { clockInputFor, loadClockFacts } from "@/server/guarantee-clock";
import {
  APPROVAL_TOKEN_TTL_DAYS,
  approvalDueAt,
  approvalRecipientRoles,
  canDecideApproval,
  canSubmitForApproval,
  cloneUsable,
  hasKiLabel,
  verzugStartDay,
  type CloneFacts,
  type GateItem,
  type GateResult,
} from "@/lib/content-gate";
import {
  CONTENT_FORMAT_LABELS,
  isContentStatus,
  type ContentFormat,
  type ContentStatus,
} from "@/lib/content-status";
import { isEditableStatus } from "@/lib/content-items";
import {
  LINK_EXPIRED_MESSAGE,
  approvalDueDayOf,
  approvalVerzugReason,
  firstDecisionOutcome,
  formatApprovalDue,
  groupApprovalRecipients,
  isApprovalDecision,
  linkExpired,
  normalizeDecision,
  statusAfterDecision,
  verzugEndDay,
  type ApprovalDecision,
  type RecordedDecision,
} from "@/lib/content-approval";
import type { Role } from "@/lib/constants";

/**
 * Phase 4 approval of posts (Beiträge): the Prüf-Schranke facts the admin
 * records, the weekly batch with one-click links, the Praxis decision (link
 * and portal, D7: the first decision wins) and the Verzug a late batch causes
 * in the Garantie-Uhr.
 *
 * Writes run on the superuser handle `db` (content_approvals is read-only for
 * eins_app); the portal reads through RLS (withClinicContext).
 *
 * First decision wins: the decision is a conditional
 *   UPDATE content_approvals SET decision = … WHERE id = … AND decision IS NULL
 * in one transaction with the post status. A second attempt (other button,
 * other person, replayed link) updates nothing and gets the recorded decision.
 *
 * Inhaber only (clone posts, approvals.inhaber_only):
 *   - portal: canDecideApproval(session role, inhaber_only) before the update;
 *   - link: the link token of a clone post is e-mailed to Inhaber users only
 *     (approvalRecipientRoles), so holding it is the Inhaber's credential, the
 *     same trust model as a magic link. decided_by_user_id stays null,
 *     decided_via 'link'.
 */

/** Rule or input violation; shown to the admin or the Praxis as is. */
export class ApprovalRuleError extends Error {}

type AdminActor = { email: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Handle = typeof db | Tx | typeof dbApp;

const TOKEN_REGEX = /^[a-f0-9]{64}$/;
const BATCH_MAX_POSTS = 50;
const ADMIN_BATCHES_SHOWN = 20;
const CHANGED = "Der Beitrag hat sich inzwischen geändert. Bitte neu laden.";

export function hashApprovalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isApprovalTokenShape(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function formatLabel(f: string): string {
  return CONTENT_FORMAT_LABELS[f as ContentFormat] ?? f;
}

function asDecision(v: string | null): ApprovalDecision | null {
  return isApprovalDecision(v) ? v : null;
}

function recordedOf(row: {
  decision: string | null;
  changeText: string | null;
  decidedAt: Date | null;
  decidedVia: string | null;
}): RecordedDecision | null {
  const decision = asDecision(row.decision);
  if (!decision || !row.decidedAt) return null;
  return {
    decision,
    changeText: row.changeText,
    decidedAt: row.decidedAt,
    decidedVia: row.decidedVia === "link" ? "link" : "portal",
  };
}

// ---------------------------------------------------------------------------
// Prüf-Schranke facts
// ---------------------------------------------------------------------------

/** The clinic's KI-Klon record for the gate: the latest row not deleted. */
async function latestCloneFacts(h: Handle, clinicId: string): Promise<CloneFacts | null> {
  const c = schema.cloneRecords;
  const [row] = await h
    .select({
      consentSignedAt: c.consentSignedAt,
      consentDocumentKey: c.consentDocumentKey,
      trainingOptoutDocumentKey: c.trainingOptoutDocumentKey,
      trainingOptoutConfirmedAt: c.trainingOptoutConfirmedAt,
      modelCreatedAt: c.modelCreatedAt,
      revokedAt: c.revokedAt,
      deletedAt: c.deletedAt,
    })
    .from(c)
    .where(and(eq(c.clinicId, clinicId), isNull(c.deletedAt)))
    .orderBy(desc(c.createdAt))
    .limit(1);
  return row ?? null;
}

type ItemRow = typeof schema.contentItems.$inferSelect;
type HwgRow = { id: string; input: string; verdict: string; findings: unknown; createdAt: Date };

async function hwgChecksById(h: Handle, ids: string[]): Promise<Map<string, HwgRow>> {
  if (ids.length === 0) return new Map();
  const rows = await h
    .select({
      id: schema.hwgChecks.id,
      input: schema.hwgChecks.input,
      verdict: schema.hwgChecks.verdict,
      findings: schema.hwgChecks.findings,
      createdAt: schema.hwgChecks.createdAt,
    })
    .from(schema.hwgChecks)
    .where(inArray(schema.hwgChecks.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function hwgVerdict(v: string): "clean" | "warn" | "violation" {
  return v === "clean" || v === "warn" ? v : "violation";
}

function gateItemOf(item: ItemRow, hwg: HwgRow | null): GateItem {
  return {
    status: isContentStatus(item.status) ? item.status : "entwurf",
    caption: item.caption,
    usesClone: item.usesClone,
    aiContent: item.aiContent,
    hwgCheck: hwg ? { input: hwg.input, verdict: hwgVerdict(hwg.verdict) } : null,
    hwgWarningsAckBy: item.hwgWarningsAckBy,
    noBeforeAfterConfirmedBy: item.noBeforeAfterConfirmedBy,
  };
}

function findingsOf(raw: unknown): Array<Pick<HwgFinding, "severity" | "reason" | "match" | "reference">> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      severity: f.severity === "red" ? "red" : "yellow",
      reason: typeof f.reason === "string" ? f.reason : "",
      match: typeof f.match === "string" ? f.match : "",
      reference: typeof f.reference === "string" ? f.reference : undefined,
    }));
}

async function loadEditableItem(clinicId: string, id: string): Promise<ItemRow & { status: ContentStatus }> {
  const [item] = await db
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.clinicId, clinicId)))
    .limit(1);
  if (!item || !isContentStatus(item.status)) throw new ApprovalRuleError("Beitrag nicht gefunden.");
  if (!isEditableStatus(item.status)) {
    throw new ApprovalRuleError("Das geht nur im Entwurf oder wenn die Praxis eine Änderung wünscht.");
  }
  return { ...item, status: item.status };
}

/**
 * Runs the HWG screener on the current caption, stores the check (actor
 * null: EINS, not a Praxis user), links it to the post and clears an earlier
 * acknowledgement (it belonged to the old check).
 */
export async function runHwgCheckForItem(
  admin: AdminActor,
  input: { clinicId: string; id: string }
): Promise<"clean" | "warn" | "violation"> {
  const item = await loadEditableItem(input.clinicId, input.id);
  const caption = item.caption?.trim() ?? "";
  if (!caption) throw new ApprovalRuleError("Der Beitragstext fehlt.");
  const result = checkHwg(caption);

  const checkId = await db.transaction(async (tx) => {
    const [check] = await tx
      .insert(schema.hwgChecks)
      .values({ clinicId: input.clinicId, actorId: null, input: caption, verdict: result.verdict, findings: result.findings })
      .returning({ id: schema.hwgChecks.id });
    const [row] = await tx
      .update(schema.contentItems)
      .set({ hwgCheckId: check!.id, hwgWarningsAckBy: null, hwgWarningsAckAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentItems.id, item.id),
          eq(schema.contentItems.clinicId, input.clinicId),
          eq(schema.contentItems.status, item.status),
          item.caption === null ? isNull(schema.contentItems.caption) : eq(schema.contentItems.caption, item.caption)
        )
      )
      .returning({ id: schema.contentItems.id });
    if (!row) throw new ApprovalRuleError(CHANGED);
    return check!.id;
  });

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "hwg_check",
    entityId: checkId,
    diff: { contentItemId: item.id, verdict: result.verdict, findings: result.findings.length },
  });
  return result.verdict;
}

/** The admin acknowledges the warnings of the current (warn) check by name. */
export async function acknowledgeHwgWarnings(admin: AdminActor, input: { clinicId: string; id: string }): Promise<void> {
  const item = await loadEditableItem(input.clinicId, input.id);
  const check = item.hwgCheckId ? (await hwgChecksById(db, [item.hwgCheckId])).get(item.hwgCheckId) : undefined;
  if (!check || check.input.trim() !== (item.caption?.trim() ?? "")) {
    throw new ApprovalRuleError("Bitte zuerst die HWG-Prüfung für den aktuellen Beitragstext ausführen.");
  }
  if (check.verdict !== "warn") throw new ApprovalRuleError("Nur Hinweise (keine Verstöße) lassen sich bestätigen.");

  const [row] = await db
    .update(schema.contentItems)
    .set({ hwgWarningsAckBy: admin.email, hwgWarningsAckAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.contentItems.id, item.id),
        eq(schema.contentItems.clinicId, input.clinicId),
        eq(schema.contentItems.hwgCheckId, check.id)
      )
    )
    .returning({ id: schema.contentItems.id });
  if (!row) throw new ApprovalRuleError(CHANGED);
  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "approve",
    entityKind: "hwg_check",
    entityId: check.id,
    diff: { contentItemId: item.id, warningsAcknowledged: true },
  });
}

/** "Keine Vorher-Nachher-Darstellung, …" confirmed (or withdrawn) by name. */
export async function setNoBeforeAfterConfirmation(
  admin: AdminActor,
  input: { clinicId: string; id: string; confirmed: boolean }
): Promise<void> {
  const item = await loadEditableItem(input.clinicId, input.id);
  const now = new Date();
  const [row] = await db
    .update(schema.contentItems)
    .set({
      noBeforeAfterConfirmedBy: input.confirmed ? admin.email : null,
      noBeforeAfterConfirmedAt: input.confirmed ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.contentItems.id, item.id),
        eq(schema.contentItems.clinicId, input.clinicId),
        eq(schema.contentItems.status, item.status)
      )
    )
    .returning({ id: schema.contentItems.id });
  if (!row) throw new ApprovalRuleError(CHANGED);
  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "content_item",
    entityId: item.id,
    diff: { noBeforeAfterConfirmed: input.confirmed },
  });
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export interface BatchPost {
  approvalId: string;
  itemId: string;
  title: string;
  format: string;
  caption: string | null;
  usesClone: boolean;
  aiContent: boolean;
  inhaberOnly: boolean;
  /** The one-click token. Only in memory, never stored (token_hash is). */
  token: string;
}

export interface CreatedBatch {
  batchId: string;
  clinicId: string;
  sentAt: Date;
  dueAt: Date;
  posts: BatchPost[];
}

/**
 * One transaction: lock the posts, re-check every one with the gate (any
 * failure rejects the whole batch and names the posts), create the batch,
 * set the posts to zur_freigabe and create one approval per post with a
 * fresh 32-byte token (only its sha256 is stored).
 */
export async function createApprovalBatch(
  admin: AdminActor,
  clinicId: string,
  itemIds: string[]
): Promise<CreatedBatch> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) throw new ApprovalRuleError("Bitte mindestens einen Beitrag auswählen.");
  if (ids.length > BATCH_MAX_POSTS) {
    throw new ApprovalRuleError(`Höchstens ${BATCH_MAX_POSTS} Beiträge pro Freigabe-Paket.`);
  }

  let created: CreatedBatch;
  try {
    created = await db.transaction(async (tx) => {
      const items = await tx
        .select()
        .from(schema.contentItems)
        .where(and(eq(schema.contentItems.clinicId, clinicId), inArray(schema.contentItems.id, ids)))
        .orderBy(schema.contentItems.createdAt)
        .for("update");
      if (items.length !== ids.length) throw new ApprovalRuleError("Ein ausgewählter Beitrag gehört nicht zu dieser Praxis.");

      const checks = await hwgChecksById(
        tx,
        items.map((i) => i.hwgCheckId).filter((v): v is string => !!v)
      );
      const clone = await latestCloneFacts(tx, clinicId);
      const failing: string[] = [];
      for (const item of items) {
        const gate = canSubmitForApproval(gateItemOf(item, item.hwgCheckId ? checks.get(item.hwgCheckId) ?? null : null), clone);
        if (!gate.ok) failing.push(`„${item.title}“`);
      }
      if (failing.length > 0) {
        throw new ApprovalRuleError(
          `Nichts gesendet. Diese Beiträge erfüllen die Prüf-Schranke nicht: ${failing.join(", ")}.`
        );
      }

      // Every post needs someone who may decide it, or the 2-Werktage
      // clock would run against a Praxis that never got the question.
      const deciders = await tx
        .select({ role: schema.clinicUsers.role })
        .from(schema.clinicUsers)
        .where(
          and(
            eq(schema.clinicUsers.clinicId, clinicId),
            isNull(schema.clinicUsers.archivedAt),
            inArray(schema.clinicUsers.role, ["inhaber", "marketing"])
          )
        );
      const roles = new Set(deciders.map((d) => d.role));
      const unreachable = items
        .filter((i) => !approvalRecipientRoles(i.usesClone).some((r) => roles.has(r)))
        .map((i) => `„${i.title}“`);
      if (unreachable.length > 0) {
        throw new ApprovalRuleError(
          `Nichts gesendet. Niemand in dieser Praxis darf über diese Beiträge entscheiden (Klon-Beiträge nur Inhaber-Zugänge): ${unreachable.join(", ")}.`
        );
      }

      const sentAt = new Date();
      const dueAt = approvalDueAt(sentAt);
      const [batch] = await tx
        .insert(schema.contentApprovalBatches)
        .values({ clinicId, sentAt, dueAt, sentBy: admin.email })
        .returning({ id: schema.contentApprovalBatches.id });

      const moved = await tx
        .update(schema.contentItems)
        .set({ status: "zur_freigabe", updatedAt: sentAt })
        .where(
          and(
            eq(schema.contentItems.clinicId, clinicId),
            inArray(schema.contentItems.id, ids),
            eq(schema.contentItems.status, "entwurf")
          )
        )
        .returning({ id: schema.contentItems.id });
      if (moved.length !== ids.length) throw new ApprovalRuleError(CHANGED);

      const expires = new Date(sentAt.getTime() + APPROVAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      const withTokens = items.map((item) => ({ item, token: randomBytes(32).toString("hex") }));
      const approvals = await tx
        .insert(schema.contentApprovals)
        .values(
          withTokens.map(({ item, token }) => ({
            batchId: batch!.id,
            contentItemId: item.id,
            clinicId,
            tokenHash: hashApprovalToken(token),
            tokenExpiresAt: expires,
            inhaberOnly: item.usesClone,
          }))
        )
        .returning({ id: schema.contentApprovals.id, contentItemId: schema.contentApprovals.contentItemId });
      const approvalByItem = new Map(approvals.map((a) => [a.contentItemId, a.id]));

      return {
        batchId: batch!.id,
        clinicId,
        sentAt,
        dueAt,
        posts: withTokens.map(({ item, token }) => ({
          approvalId: approvalByItem.get(item.id)!,
          itemId: item.id,
          title: item.title,
          format: item.format,
          caption: item.caption,
          usesClone: item.usesClone,
          aiContent: item.aiContent,
          inhaberOnly: item.usesClone,
          token,
        })),
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApprovalRuleError("Ein ausgewählter Beitrag wartet schon auf Freigabe.");
    throw err;
  }

  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "content_approval_batch",
    entityId: created.batchId,
    diff: {
      posts: created.posts.map((p) => p.itemId),
      dueAt: created.dueAt.toISOString(),
      inhaberOnly: created.posts.filter((p) => p.inhaberOnly).length,
    },
  });
  return created;
}

export interface BatchMailResult {
  sent: string[];
  duplicate: string[];
  suppressed: string[];
  failed: string[];
  /** Posts nobody could be e-mailed for (e.g. a clone post without an active Inhaber login). */
  postsWithoutRecipient: string[];
}

export function approvalLinkUrl(token: string): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/freigabe/${token}`;
}

/**
 * One e-mail per active Inhaber and Marketing user, each listing the posts
 * that person may decide (clone posts to Inhaber users only). Idempotent per
 * batch and address (sendEmailOnce key).
 */
export async function sendApprovalBatchEmails(batch: CreatedBatch): Promise<BatchMailResult> {
  const [[clinic], users] = await Promise.all([
    db
      .select({ name: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, batch.clinicId))
      .limit(1),
    db
      .select({ email: schema.clinicUsers.email, fullName: schema.clinicUsers.fullName, role: schema.clinicUsers.role })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, batch.clinicId),
          isNull(schema.clinicUsers.archivedAt),
          inArray(schema.clinicUsers.role, ["inhaber", "marketing"])
        )
      )
      .orderBy(schema.clinicUsers.role, schema.clinicUsers.email),
  ]);

  const groups = groupApprovalRecipients(batch.posts, users, approvalRecipientRoles);
  const reached = new Set(groups.flatMap((g) => g.posts.map((p) => p.itemId)));
  const result: BatchMailResult = {
    sent: [],
    duplicate: [],
    suppressed: [],
    failed: [],
    postsWithoutRecipient: batch.posts.filter((p) => !reached.has(p.itemId)).map((p) => p.title),
  };
  const dueDay = approvalDueDayOf(batch.dueAt);
  const portalUrl = `${env.APP_ORIGIN.replace(/\/$/, "")}/beitraege`;

  for (const { recipient, posts } of groups) {
    const mail = approvalBatchMail({
      recipientName: recipient.fullName,
      practiceName: clinic?.name ?? "Ihre Praxis",
      dueLabel: formatApprovalDue(batch.dueAt),
      dueDate: formatIsoDate(dueDay),
      posts: posts.map((p) => ({
        title: p.title,
        format: formatLabel(p.format),
        caption: p.caption,
        kiLabel: hasKiLabel(p.caption),
        usesClone: p.usesClone,
        url: approvalLinkUrl(p.token),
      })),
      portalUrl,
      linkTtlDays: APPROVAL_TOKEN_TTL_DAYS,
    });
    try {
      const r = await sendEmailOnce({
        key: `content-approval/${batch.batchId}/${recipient.email}`,
        clinicId: batch.clinicId,
        to: recipient.email,
        subject: mail.subject,
        text: mail.text,
      });
      result[r === "sent" ? "sent" : r === "duplicate" ? "duplicate" : "suppressed"].push(recipient.email);
    } catch (err) {
      console.error("[content-approval] batch mail failed:", err instanceof Error ? err.name : "unknown");
      result.failed.push(recipient.email);
    }
  }
  return result;
}

/** Admin "Freigabe-Paket senden": create the batch, then the e-mails after commit. */
export async function sendApprovalBatch(
  admin: AdminActor,
  clinicId: string,
  itemIds: string[]
): Promise<{ batch: CreatedBatch; mail: BatchMailResult }> {
  const batch = await createApprovalBatch(admin, clinicId, itemIds);
  const mail = await sendApprovalBatchEmails(batch);
  await writeAudit({
    clinicId,
    actorEmail: admin.email,
    action: "deliver",
    entityKind: "content_approval_batch",
    entityId: batch.batchId,
    diff: {
      sent: mail.sent.length,
      failed: mail.failed.length,
      suppressed: mail.suppressed.length,
      postsWithoutRecipient: mail.postsWithoutRecipient.length,
    },
  });
  return { batch, mail };
}

// ---------------------------------------------------------------------------
// Verzug link helpers (shared by decision, pull-back, stop and the job)
// ---------------------------------------------------------------------------

/**
 * Closes the batch's Verzug once no post of the batch is open any more:
 * to_date = `day` (never before from_date). No-op while posts are open or
 * when there is no open Verzug.
 */
export async function closeBatchDelayIfDone(h: Handle, batchId: string, day: IsoDate): Promise<number> {
  const rows = (await h.execute(sql`
    UPDATE guarantee_delays SET to_date = GREATEST(from_date, ${day}::date)
    WHERE approval_batch_id = ${batchId} AND to_date IS NULL
      AND NOT EXISTS (SELECT 1 FROM content_approvals WHERE batch_id = ${batchId} AND decision IS NULL)
    RETURNING id
  `)) as unknown as unknown[];
  return rows.length;
}

/**
 * EINS takes a post back from the Praxis (pull-back to Entwurf, or stop):
 * the post's open approval row goes, in the caller's transaction, and the
 * batch's Verzug closes if nothing else is open.
 */
export async function withdrawOpenApproval(tx: Handle, itemId: string): Promise<number> {
  const removed = await tx
    .delete(schema.contentApprovals)
    .where(and(eq(schema.contentApprovals.contentItemId, itemId), isNull(schema.contentApprovals.decision)))
    .returning({ batchId: schema.contentApprovals.batchId });
  const today = berlinDate(new Date());
  for (const r of removed) await closeBatchDelayIfDone(tx, r.batchId, today);
  return removed.length;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type DecisionActor =
  | {
      via: "portal";
      clinicId: string;
      userId: string;
      email: string;
      role: Role;
    }
  | { via: "link"; requestMeta?: { ip?: string | null; ua?: string | null } };

export type DecisionFailure = "invalid" | "not_found" | "forbidden" | "expired";

export type DecisionResult =
  | {
      ok: true;
      /** false: an earlier decision was already on record (first wins). */
      recorded: boolean;
      decision: RecordedDecision;
      clinicId: string;
      approvalId: string;
    }
  | { ok: false; reason: DecisionFailure; message: string };

export const NOT_INHABER_MESSAGE =
  "In diesem Beitrag erscheint der KI-Klon. Freigeben kann ihn nur die Inhaberin oder der Inhaber.";

/**
 * The one decision path for link and portal. One transaction:
 *   1. find the approval (by id within the session's Praxis, or by token hash);
 *   2. portal: role check (canDecideApproval); link: expiry check while open;
 *   3. lock the post, then UPDATE … WHERE decision IS NULL RETURNING: only
 *      the first decision is written, any later one reads it back;
 *   4. move the post from zur_freigabe to the decision (canPraxisDecide);
 *   5. close the batch's Verzug when no post of the batch is open any more.
 */
export async function decideApproval(
  target: { approvalId: string } | { tokenHash: string },
  decisionRaw: unknown,
  changeTextRaw: unknown,
  actor: DecisionActor
): Promise<DecisionResult> {
  const input = normalizeDecision(decisionRaw, changeTextRaw);
  if (!input.ok) return { ok: false, reason: "invalid", message: input.error };

  const a = schema.contentApprovals;
  const where =
    "approvalId" in target
      ? actor.via === "portal"
        ? and(eq(a.id, target.approvalId), eq(a.clinicId, actor.clinicId))
        : eq(a.id, target.approvalId)
      : eq(a.tokenHash, target.tokenHash);

  type Inner = { result: DecisionResult; statusFrom?: string; statusTo?: ContentStatus | null };
  const notFound: DecisionResult = { ok: false, reason: "not_found", message: "Diese Freigabe gibt es nicht mehr." };

  const out = await db.transaction(async (tx): Promise<Inner> => {
    const [row] = await tx.select().from(a).where(where).limit(1);
    if (!row) return { result: notFound };

    if (actor.via === "portal" && !canDecideApproval(actor.role, row.inhaberOnly)) {
      return {
        result: {
          ok: false,
          reason: "forbidden",
          message: row.inhaberOnly ? NOT_INHABER_MESSAGE : "Freigeben können nur Inhaber und Marketing.",
        },
      };
    }
    const base = { clinicId: row.clinicId, approvalId: row.id };
    const already = recordedOf(row);
    if (already) return { result: { ok: true, recorded: false, decision: already, ...base } };
    if (actor.via === "link" && linkExpired(row.tokenExpiresAt)) {
      return { result: { ok: false, reason: "expired", message: LINK_EXPIRED_MESSAGE } };
    }

    // Lock order post, then approval: the same as pull-back and stop.
    const [item] = await tx
      .select({ status: schema.contentItems.status })
      .from(schema.contentItems)
      .where(eq(schema.contentItems.id, row.contentItemId))
      .for("update");

    const [claimed] = await tx
      .update(a)
      .set({
        decision: input.decision,
        changeText: input.changeText,
        decidedAt: sql`now()`,
        decidedByUserId: actor.via === "portal" ? actor.userId : null,
        decidedVia: actor.via,
      })
      .where(and(eq(a.id, row.id), isNull(a.decision)))
      .returning();

    if (!claimed) {
      const [current] = await tx.select().from(a).where(eq(a.id, row.id)).limit(1);
      const outcome = firstDecisionOutcome(null, current ? recordedOf(current) : null);
      if (!outcome.decision) return { result: notFound };
      return { result: { ok: true, recorded: false, decision: outcome.decision, ...base } };
    }

    const decided = recordedOf(claimed)!;
    let statusTo: ContentStatus | null = null;
    if (item && isContentStatus(item.status)) {
      statusTo = statusAfterDecision(item.status, decided.decision);
      if (statusTo) {
        await tx
          .update(schema.contentItems)
          .set({ status: statusTo, updatedAt: new Date() })
          .where(eq(schema.contentItems.id, row.contentItemId));
      }
    }
    await closeBatchDelayIfDone(tx, row.batchId, berlinDate(decided.decidedAt));
    return {
      result: { ok: true, recorded: true, decision: decided, ...base },
      statusFrom: item?.status,
      statusTo,
    };
  });

  const r = out.result;
  if (r.ok && r.recorded) {
    await writeAudit({
      clinicId: r.clinicId,
      actorId: actor.via === "portal" ? actor.userId : null,
      actorEmail: actor.via === "portal" ? actor.email : null,
      action: r.decision.decision === "freigegeben" ? "approve" : "reject",
      entityKind: "content_approval",
      entityId: r.approvalId,
      diff: {
        decision: r.decision.decision,
        via: actor.via,
        hasChangeText: Boolean(r.decision.changeText),
        status: out.statusTo ? { from: out.statusFrom, to: out.statusTo } : "unverändert",
      },
      ...(actor.via === "link" ? { requestMeta: actor.requestMeta ?? {}, impersonatedByAdminId: null } : {}),
    });
  }
  return r;
}

/** Link path: token shape, sha256 lookup, expiry (inside decideApproval). */
export async function decideApprovalByToken(
  token: string,
  decision: unknown,
  changeText: unknown,
  requestMeta?: { ip?: string | null; ua?: string | null }
): Promise<DecisionResult> {
  if (!isApprovalTokenShape(token)) return { ok: false, reason: "not_found", message: "Dieser Link ist ungültig." };
  return decideApproval({ tokenHash: hashApprovalToken(token) }, decision, changeText, { via: "link", requestMeta });
}

/** Portal path: the session's Praxis and role decide (canDecideApproval). */
export async function decideApprovalInPortal(
  session: { clinicId: string; userId: string; email: string; role: Role },
  approvalId: string,
  decision: unknown,
  changeText: unknown
): Promise<DecisionResult> {
  return decideApproval({ approvalId }, decision, changeText, {
    via: "portal",
    clinicId: session.clinicId,
    userId: session.userId,
    email: session.email,
    role: session.role,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LinkApprovalView {
  approvalId: string;
  practiceName: string;
  title: string;
  format: string;
  caption: string | null;
  usesClone: boolean;
  aiContent: boolean;
  inhaberOnly: boolean;
  itemStatus: string;
  asset: { storageKey: string; kind: string; mimeType: string | null } | null;
  dueAt: Date;
  expired: boolean;
  decision: RecordedDecision | null;
}

/** What /freigabe/[token] shows. Null for an unknown or malformed token. */
export async function loadApprovalForLink(token: string): Promise<LinkApprovalView | null> {
  if (!isApprovalTokenShape(token)) return null;
  const a = schema.contentApprovals;
  const i = schema.contentItems;
  const [row] = await db
    .select({
      approval: a,
      dueAt: schema.contentApprovalBatches.dueAt,
      practiceName: schema.clinics.displayName,
      title: i.title,
      format: i.format,
      caption: i.caption,
      usesClone: i.usesClone,
      aiContent: i.aiContent,
      status: i.status,
      assetKey: schema.assets.storageKey,
      assetKind: schema.assets.kind,
      assetMime: schema.assets.mimeType,
    })
    .from(a)
    .innerJoin(schema.contentApprovalBatches, eq(schema.contentApprovalBatches.id, a.batchId))
    .innerJoin(i, eq(i.id, a.contentItemId))
    .innerJoin(schema.clinics, eq(schema.clinics.id, a.clinicId))
    .leftJoin(schema.assets, and(eq(schema.assets.id, i.assetId), eq(schema.assets.clinicId, a.clinicId)))
    .where(eq(a.tokenHash, hashApprovalToken(token)))
    .limit(1);
  if (!row) return null;
  return {
    approvalId: row.approval.id,
    practiceName: row.practiceName,
    title: row.title,
    format: formatLabel(row.format),
    caption: row.caption,
    usesClone: row.usesClone,
    aiContent: row.aiContent,
    inhaberOnly: row.approval.inhaberOnly,
    itemStatus: row.status,
    asset: row.assetKey ? { storageKey: row.assetKey, kind: row.assetKind ?? "", mimeType: row.assetMime } : null,
    dueAt: row.dueAt,
    expired: linkExpired(row.approval.tokenExpiresAt),
    decision: recordedOf(row.approval),
  };
}

export interface PracticeApprovalView {
  id: string;
  inhaberOnly: boolean;
  decision: RecordedDecision | null;
  dueAt: Date;
}

/** Latest approval per post for /beitraege, through RLS. */
export async function listApprovalsForPractice(
  clinicId: string,
  userId: string
): Promise<Map<string, PracticeApprovalView>> {
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx
        .select({ approval: schema.contentApprovals, dueAt: schema.contentApprovalBatches.dueAt })
        .from(schema.contentApprovals)
        .innerJoin(schema.contentApprovalBatches, eq(schema.contentApprovalBatches.id, schema.contentApprovals.batchId))
        .where(eq(schema.contentApprovals.clinicId, clinicId))
        .orderBy(desc(schema.contentApprovals.createdAt)),
    "beitraege:approvals"
  );
  const out = new Map<string, PracticeApprovalView>();
  for (const r of rows) {
    if (out.has(r.approval.contentItemId)) continue;
    out.set(r.approval.contentItemId, {
      id: r.approval.id,
      inhaberOnly: r.approval.inhaberOnly,
      decision: recordedOf(r.approval),
      dueAt: r.dueAt,
    });
  }
  return out;
}

export interface GateView {
  result: GateResult;
  hwg: {
    verdict: "clean" | "warn" | "violation";
    /** The check was made on the caption as it is now. */
    current: boolean;
    checkedAt: Date;
    findings: ReturnType<typeof findingsOf>;
  } | null;
  hwgWarningsAckBy: string | null;
  hwgWarningsAckAt: Date | null;
  noBeforeAfterConfirmedBy: string | null;
  noBeforeAfterConfirmedAt: Date | null;
}

export interface AdminBatchView {
  id: string;
  sentAt: Date;
  dueAt: Date;
  sentBy: string | null;
  verzug: { fromDate: string; toDate: string | null; notifiedAt: Date | null } | null;
  posts: Array<{
    itemId: string;
    title: string;
    inhaberOnly: boolean;
    decision: RecordedDecision | null;
  }>;
}

export interface AdminApprovalData {
  gate: Map<string, GateView>;
  /** Latest approval per post (change text on aenderung posts, due date on waiting ones). */
  latest: Map<string, { decision: RecordedDecision | null; dueAt: Date; inhaberOnly: boolean }>;
  batches: AdminBatchView[];
  cloneUsable: boolean;
}

/** Gate state per post, the latest approval per post and the recent batches (admin tab). */
export async function loadApprovalAdminData(clinicId: string): Promise<AdminApprovalData> {
  const [items, clone, batches] = await Promise.all([
    db.select().from(schema.contentItems).where(eq(schema.contentItems.clinicId, clinicId)),
    latestCloneFacts(db, clinicId),
    db
      .select()
      .from(schema.contentApprovalBatches)
      .where(eq(schema.contentApprovalBatches.clinicId, clinicId))
      .orderBy(desc(schema.contentApprovalBatches.sentAt))
      .limit(ADMIN_BATCHES_SHOWN),
  ]);
  const checks = await hwgChecksById(
    db,
    items.map((i) => i.hwgCheckId).filter((v): v is string => !!v)
  );
  const batchIds = batches.map((b) => b.id);
  const [approvals, delays] = await Promise.all([
    db
      .select({ approval: schema.contentApprovals, dueAt: schema.contentApprovalBatches.dueAt })
      .from(schema.contentApprovals)
      .innerJoin(schema.contentApprovalBatches, eq(schema.contentApprovalBatches.id, schema.contentApprovals.batchId))
      .where(eq(schema.contentApprovals.clinicId, clinicId))
      .orderBy(desc(schema.contentApprovals.createdAt)),
    batchIds.length
      ? db
          .select({
            batchId: schema.guaranteeDelays.approvalBatchId,
            fromDate: schema.guaranteeDelays.fromDate,
            toDate: schema.guaranteeDelays.toDate,
            notifiedAt: schema.guaranteeDelays.notifiedAt,
          })
          .from(schema.guaranteeDelays)
          .where(inArray(schema.guaranteeDelays.approvalBatchId, batchIds))
      : Promise.resolve([]),
  ]);

  const gate = new Map<string, GateView>();
  for (const item of items) {
    const check = item.hwgCheckId ? checks.get(item.hwgCheckId) ?? null : null;
    gate.set(item.id, {
      result: canSubmitForApproval(gateItemOf(item, check), clone),
      hwg: check
        ? {
            verdict: hwgVerdict(check.verdict),
            current: check.input.trim() === (item.caption?.trim() ?? ""),
            checkedAt: check.createdAt,
            findings: findingsOf(check.findings),
          }
        : null,
      hwgWarningsAckBy: item.hwgWarningsAckBy,
      hwgWarningsAckAt: item.hwgWarningsAckAt,
      noBeforeAfterConfirmedBy: item.noBeforeAfterConfirmedBy,
      noBeforeAfterConfirmedAt: item.noBeforeAfterConfirmedAt,
    });
  }

  const latest = new Map<string, { decision: RecordedDecision | null; dueAt: Date; inhaberOnly: boolean }>();
  for (const r of approvals) {
    if (latest.has(r.approval.contentItemId)) continue;
    latest.set(r.approval.contentItemId, {
      decision: recordedOf(r.approval),
      dueAt: r.dueAt,
      inhaberOnly: r.approval.inhaberOnly,
    });
  }

  const titles = new Map(items.map((i) => [i.id, i.title]));
  const delayByBatch = new Map(delays.map((d) => [d.batchId, d]));
  return {
    gate,
    latest,
    cloneUsable: cloneUsable(clone),
    batches: batches.map((b) => {
      const d = delayByBatch.get(b.id);
      return {
        id: b.id,
        sentAt: b.sentAt,
        dueAt: b.dueAt,
        sentBy: b.sentBy,
        verzug: d ? { fromDate: d.fromDate, toDate: d.toDate, notifiedAt: d.notifiedAt } : null,
        posts: approvals
          .filter((r) => r.approval.batchId === b.id)
          .map((r) => ({
            itemId: r.approval.contentItemId,
            title: titles.get(r.approval.contentItemId) ?? "Beitrag",
            inhaberOnly: r.approval.inhaberOnly,
            decision: recordedOf(r.approval),
          })),
      };
    }),
  };
}

/** Sending day per batch id, for "aus Freigabe-Paket vom …" on the Garantie-Uhr. */
export async function approvalBatchSentDays(batchIds: string[]): Promise<Map<string, IsoDate>> {
  const ids = [...new Set(batchIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.contentApprovalBatches.id, sentAt: schema.contentApprovalBatches.sentAt })
    .from(schema.contentApprovalBatches)
    .where(inArray(schema.contentApprovalBatches.id, ids));
  return new Map(rows.map((r) => [r.id, berlinDate(r.sentAt)]));
}

// ---------------------------------------------------------------------------
// Verzug job
// ---------------------------------------------------------------------------

/**
 * Late batches become a Verzug in the Garantie-Uhr; decided ones close it.
 *
 * Create: a batch past due_at with an open post, whose Praxis has a running
 * guarantee clock (no confirmed qualifying inquiry, no manual end). One row
 * per batch (unique approval_batch_id, ON CONFLICT DO NOTHING), kind
 * 'verzug', from the day after the due day, to_date and notified_at NULL: it
 * counts only once EINS sends the notice on /admin/garantie/[clinicId].
 *
 * Close: an open Verzug whose batch has no open post any more gets to_date =
 * Berlin day of the last decision (covers anything the decision path missed).
 */
export async function processContentApprovalVerzug(
  opts: { clinicId?: string; now?: Date } = {}
): Promise<{ created: number; closed: number }> {
  const now = opts.now ?? new Date();
  const clinicFilter = opts.clinicId ? sql`AND b.clinic_id = ${opts.clinicId}` : sql``;

  const lateRows = (await db.execute(sql`
    SELECT b.id, b.clinic_id, b.sent_at, b.due_at
    FROM content_approval_batches b
    JOIN guarantee_clocks g ON g.clinic_id = b.clinic_id
    WHERE b.due_at < ${now.toISOString()}::timestamptz
      AND g.qualifying_request_id IS NULL
      AND g.qualifying_inquiry_on IS NULL
      AND g.manual_end_state IS NULL
      AND EXISTS (SELECT 1 FROM content_approvals a WHERE a.batch_id = b.id AND a.decision IS NULL)
      AND NOT EXISTS (SELECT 1 FROM guarantee_delays d WHERE d.approval_batch_id = b.id)
      ${clinicFilter}
  `)) as unknown as Array<{ id: string; clinic_id: string; sent_at: Date | string; due_at: Date | string }>;

  // Only while the Garantie-Uhr still runs: after its deadline a Verzug can
  // no longer move anything (a notice after the deadline does not count).
  const today = berlinDate(now);
  const running = new Map<string, boolean>();
  const late: typeof lateRows = [];
  for (const b of lateRows) {
    if (!running.has(b.clinic_id)) {
      const facts = await loadClockFacts(b.clinic_id);
      running.set(b.clinic_id, computeClock(clockInputFor(facts.clock, facts.delays, today)).status === "laeuft");
    }
    if (running.get(b.clinic_id)) late.push(b);
  }

  let created = 0;
  for (const b of late) {
    const dueAt = new Date(b.due_at);
    const inserted = (await db.execute(sql`
      INSERT INTO guarantee_delays (clinic_id, kind, from_date, to_date, reason, notified_at, created_by, approval_batch_id)
      VALUES (${b.clinic_id}, 'verzug', ${verzugStartDay(dueAt)}::date, NULL,
              ${approvalVerzugReason(new Date(b.sent_at))}, NULL, 'system', ${b.id})
      ON CONFLICT DO NOTHING
      RETURNING id
    `)) as unknown as unknown[];
    created += inserted.length;
  }

  const closeFilter = opts.clinicId ? sql`AND d.clinic_id = ${opts.clinicId}` : sql``;
  const done = (await db.execute(sql`
    SELECT d.id, d.from_date::text AS from_date, max(a.decided_at) AS last_decided_at
    FROM guarantee_delays d
    LEFT JOIN content_approvals a ON a.batch_id = d.approval_batch_id
    WHERE d.approval_batch_id IS NOT NULL AND d.to_date IS NULL ${closeFilter}
    GROUP BY d.id, d.from_date
    HAVING count(a.id) FILTER (WHERE a.decision IS NULL) = 0
  `)) as unknown as Array<{ id: string; from_date: string; last_decided_at: Date | string | null }>;

  let closed = 0;
  for (const d of done) {
    const last = d.last_decided_at ? new Date(d.last_decided_at) : null;
    const rows = (await db.execute(sql`
      UPDATE guarantee_delays SET to_date = ${verzugEndDay(d.from_date, last, now)}::date
      WHERE id = ${d.id} AND to_date IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    closed += rows.length;
  }
  return { created, closed };
}
