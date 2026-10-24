import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, adminOrigin } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import { sendEmailOnce } from "@/server/email-once";
import { operatorRecipient } from "@/server/request-notify";
import { getStorage } from "@/server/storage";
import { normalizeContentType, verifyUploadedObject, type UploadTarget } from "@/server/uploads";
import { postsToStopOnRevocation, type CloneFacts } from "@/lib/content-gate";
import { isContentStatus, type ContentStatus } from "@/lib/content-status";
import { berlinDate, isIsoDate, type IsoDate } from "@/lib/guarantee-clock";
import { withdrawOpenApproval } from "@/server/content-approval";
import { berlinMidnight } from "@/lib/werkstunden";
import {
  MAX_CLONE_DOCUMENT_BYTES,
  cloneDocumentKeyPrefix,
  isCloneDocumentExtension,
  isCloneDocumentKey,
  modelBlockReason,
  modelDateProblem,
  revocationMail,
  revocationStopReason,
} from "@/lib/clone-record";

/**
 * KI-Klon records (clone_records, migration 0101). Admin only: every read and
 * write runs on the superuser handle, the table has RLS on and no grant for
 * the app role, so the Praxis never sees it.
 *
 * Enforced here, not only in the UI:
 *   - setModelCreated only when canCreateModel (consent signed with document,
 *     the tool's training opt-out documented and confirmed, not revoked, not
 *     deleted); the table CHECKs back this up.
 *   - revokeClone is one transaction: revoked_at, then every clone post of
 *     the Praxis not yet stopped gets stop_requested_at ("zu stoppen"). A
 *     second call finds revoked_at set and changes nothing. Posts flagged
 *     earlier keep their first reason.
 *   - documents live under klon/<clinicId>/, never under the Praxis prefix.
 */

/** Rule or input violation; the message is shown to the admin as is. */
export class CloneRuleError extends Error {}

type AdminActor = { email: string };

export type CloneRecord = typeof schema.cloneRecords.$inferSelect;

function facts(r: CloneRecord): CloneFacts {
  return {
    consentSignedAt: r.consentSignedAt,
    consentDocumentKey: r.consentDocumentKey,
    trainingOptoutDocumentKey: r.trainingOptoutDocumentKey,
    trainingOptoutConfirmedAt: r.trainingOptoutConfirmedAt,
    modelCreatedAt: r.modelCreatedAt,
    revokedAt: r.revokedAt,
    deletedAt: r.deletedAt,
  };
}

async function loadRecord(clinicId: string, id: string): Promise<CloneRecord> {
  const [row] = await db
    .select()
    .from(schema.cloneRecords)
    .where(and(eq(schema.cloneRecords.id, id), eq(schema.cloneRecords.clinicId, clinicId)))
    .limit(1);
  if (!row) throw new CloneRuleError("Den KI-Klon gibt es bei dieser Praxis nicht.");
  return row;
}

function dayToInstant(day: IsoDate): Date {
  if (!isIsoDate(day)) throw new CloneRuleError("Das Datum ist ungültig.");
  return berlinMidnight(day);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getCloneRecords(clinicId: string): Promise<CloneRecord[]> {
  return db
    .select()
    .from(schema.cloneRecords)
    .where(eq(schema.cloneRecords.clinicId, clinicId))
    .orderBy(asc(schema.cloneRecords.createdAt));
}

export interface StopRequestedPost {
  id: string;
  code: string;
  title: string;
  status: ContentStatus | string;
  stopRequestedAt: Date;
  stopRequestedReason: string | null;
}

/** Posts of one Praxis flagged "zu stoppen" and not stopped yet. */
export async function getStopRequestedPosts(clinicId: string): Promise<StopRequestedPost[]> {
  const rows = await db
    .select({
      id: schema.contentItems.id,
      code: schema.contentItems.code,
      title: schema.contentItems.title,
      status: schema.contentItems.status,
      stopRequestedAt: schema.contentItems.stopRequestedAt,
      stopRequestedReason: schema.contentItems.stopRequestedReason,
    })
    .from(schema.contentItems)
    .where(
      and(
        eq(schema.contentItems.clinicId, clinicId),
        isNotNull(schema.contentItems.stopRequestedAt),
        ne(schema.contentItems.status, "gestoppt")
      )
    )
    .orderBy(asc(schema.contentItems.stopRequestedAt), asc(schema.contentItems.code));
  return rows.map((r) => ({ ...r, stopRequestedAt: r.stopRequestedAt as Date }));
}

export interface StopTaskRow {
  clinicId: string;
  clinicName: string;
  count: number;
}

/** Admin home "Beiträge zu stoppen": one row per Praxis (an aggregate, no cross-Praxis limit). */
export async function listStopTasks(): Promise<StopTaskRow[]> {
  return db
    .select({
      clinicId: schema.contentItems.clinicId,
      clinicName: schema.clinics.displayName,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.contentItems)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.contentItems.clinicId))
    .where(and(isNotNull(schema.contentItems.stopRequestedAt), ne(schema.contentItems.status, "gestoppt")))
    .groupBy(schema.contentItems.clinicId, schema.clinics.displayName)
    .orderBy(desc(sql`count(*)`), asc(schema.clinics.displayName));
}

export interface DeletionTaskRow {
  id: string;
  clinicId: string;
  clinicName: string;
  personName: string;
  tool: string;
  contractEndOn: IsoDate | null;
  /** Berlin day of the revocation: deletion is due at once (KANON § 7). */
  revokedOn: IsoDate | null;
}

/** Admin home "KI-Klon löschen": every record with a contract end or a revocation and no deletion yet. */
export async function listCloneDeletionTasks(): Promise<DeletionTaskRow[]> {
  const rows = await db
    .select({
      id: schema.cloneRecords.id,
      clinicId: schema.cloneRecords.clinicId,
      clinicName: schema.clinics.displayName,
      personName: schema.cloneRecords.personName,
      tool: schema.cloneRecords.tool,
      contractEndOn: schema.cloneRecords.contractEndOn,
      revokedAt: schema.cloneRecords.revokedAt,
    })
    .from(schema.cloneRecords)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.cloneRecords.clinicId))
    .where(
      and(
        or(isNotNull(schema.cloneRecords.contractEndOn), isNotNull(schema.cloneRecords.revokedAt)),
        isNull(schema.cloneRecords.deletedAt)
      )
    )
    .orderBy(asc(schema.cloneRecords.contractEndOn), asc(schema.clinics.displayName));
  return rows.map(({ revokedAt, ...r }) => ({
    ...r,
    contractEndOn: (r.contractEndOn as IsoDate | null) ?? null,
    revokedOn: revokedAt ? berlinDate(revokedAt) : null,
  }));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Upload target for a consent or opt-out document, under klon/<clinicId>/. */
export async function createCloneDocumentTarget(input: {
  clinicId: string;
  extension: string;
  size: number;
  contentType: string | null | undefined;
}): Promise<UploadTarget> {
  const ext = input.extension.toLowerCase();
  if (!isCloneDocumentExtension(ext)) {
    throw new CloneRuleError("Nur PDF oder Foto (png, jpg, webp, heic) sind erlaubt.");
  }
  if (input.size > MAX_CLONE_DOCUMENT_BYTES) {
    throw new CloneRuleError("Die Datei ist zu groß (höchstens 25 MB).");
  }
  const key = `${cloneDocumentKeyPrefix(input.clinicId)}${randomUUID()}.${ext}`;
  const presigned = await getStorage().presignedPutUrl(key, {
    contentType: normalizeContentType(input.contentType),
    expiresInSeconds: 3600,
  });
  if (presigned) return { key, mode: "presigned", url: presigned };
  return { key, mode: "direct", url: `/api/uploads?key=${encodeURIComponent(key)}` };
}

async function verifyDocument(clinicId: string, key: string): Promise<void> {
  if (!isCloneDocumentKey(clinicId, key)) {
    throw new CloneRuleError("Das Dokument gehört nicht zu dieser Praxis.");
  }
  const head = await verifyUploadedObject(key);
  if (!head) throw new CloneRuleError("Das Dokument ist nicht angekommen. Bitte erneut hochladen.");
  if (head.size > MAX_CLONE_DOCUMENT_BYTES) {
    throw new CloneRuleError("Die Datei ist zu groß (höchstens 25 MB).");
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createCloneRecord(
  admin: AdminActor,
  input: { clinicId: string; personName: string; tool: string }
): Promise<{ id: string }> {
  const personName = input.personName.trim();
  const tool = input.tool.trim();
  if (!personName || !tool) throw new CloneRuleError("Person und Werkzeug sind Pflicht.");
  const [row] = await db
    .insert(schema.cloneRecords)
    .values({ clinicId: input.clinicId, personName, tool, createdBy: admin.email })
    .returning({ id: schema.cloneRecords.id });
  if (!row) throw new Error("clone_records insert returned no row");
  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "create",
    entityKind: "clone_record",
    entityId: row.id,
    diff: { personName, tool },
  });
  return row;
}

export type CloneRecordUpdate =
  | { kind: "einwilligung"; signedOn: IsoDate; documentKey: string }
  | { kind: "widerspruch"; confirmedOn: IsoDate; documentKey: string }
  | { kind: "vertragsende"; contractEndOn: IsoDate | null };

/**
 * One step of the record. Consent and opt-out stay changeable only until the
 * model exists (the model was built on exactly those documents); nothing
 * changes after the deletion. The contract end stays editable after a
 * revocation, the deletion alarm depends on it.
 */
export async function updateCloneRecord(
  admin: AdminActor,
  input: { clinicId: string; id: string } & CloneRecordUpdate
): Promise<void> {
  const rec = await loadRecord(input.clinicId, input.id);
  if (rec.deletedAt) throw new CloneRuleError("Der KI-Klon ist gelöscht, der Nachweis bleibt unverändert.");

  let set: Partial<typeof schema.cloneRecords.$inferInsert>;
  let diff: Record<string, unknown>;
  if (input.kind === "einwilligung" || input.kind === "widerspruch") {
    if (rec.modelCreatedAt) {
      throw new CloneRuleError("Das Modell ist angelegt. Einwilligung und Trainings-Widerspruch bleiben unverändert.");
    }
    if (rec.revokedAt) throw new CloneRuleError("Die Einwilligung ist widerrufen.");
    await verifyDocument(input.clinicId, input.documentKey);
    if (input.kind === "einwilligung") {
      const at = dayToInstant(input.signedOn);
      if (at.getTime() > Date.now()) throw new CloneRuleError("Das Datum liegt in der Zukunft.");
      set = { consentSignedAt: at, consentDocumentKey: input.documentKey };
      diff = { consentSignedOn: input.signedOn, consentDocumentKey: input.documentKey };
    } else {
      const at = dayToInstant(input.confirmedOn);
      if (at.getTime() > Date.now()) throw new CloneRuleError("Das Datum liegt in der Zukunft.");
      set = { trainingOptoutConfirmedAt: at, trainingOptoutDocumentKey: input.documentKey };
      diff = { trainingOptoutConfirmedOn: input.confirmedOn, trainingOptoutDocumentKey: input.documentKey };
    }
  } else {
    if (input.contractEndOn !== null && !isIsoDate(input.contractEndOn)) {
      throw new CloneRuleError("Das Datum ist ungültig.");
    }
    set = { contractEndOn: input.contractEndOn };
    diff = { contractEndOn: { from: rec.contractEndOn, to: input.contractEndOn } };
  }

  const [row] = await db
    .update(schema.cloneRecords)
    .set({ ...set, updatedAt: new Date() })
    .where(
      and(
        eq(schema.cloneRecords.id, input.id),
        eq(schema.cloneRecords.clinicId, input.clinicId),
        isNull(schema.cloneRecords.deletedAt),
        ...(input.kind === "vertragsende"
          ? []
          : [isNull(schema.cloneRecords.modelCreatedAt), isNull(schema.cloneRecords.revokedAt)])
      )
    )
    .returning({ id: schema.cloneRecords.id });
  if (!row) throw new CloneRuleError("Der KI-Klon wurde inzwischen geändert. Bitte die Seite neu laden.");

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "clone_record",
    entityId: input.id,
    diff: { step: input.kind, ...diff },
  });
}

/** Betriebspflicht: rejected unless canCreateModel. */
export async function setModelCreated(
  admin: AdminActor,
  input: { clinicId: string; id: string; at: Date }
): Promise<void> {
  const rec = await loadRecord(input.clinicId, input.id);
  const f = facts(rec);
  const blocked = modelBlockReason(f);
  if (blocked) throw new CloneRuleError(blocked);
  const dateProblem = modelDateProblem(f, input.at, new Date());
  if (dateProblem) throw new CloneRuleError(dateProblem);

  // The WHERE repeats the gate, so a revocation between read and write wins.
  const [row] = await db
    .update(schema.cloneRecords)
    .set({ modelCreatedAt: input.at, updatedAt: new Date() })
    .where(
      and(
        eq(schema.cloneRecords.id, input.id),
        eq(schema.cloneRecords.clinicId, input.clinicId),
        isNull(schema.cloneRecords.modelCreatedAt),
        isNull(schema.cloneRecords.revokedAt),
        isNull(schema.cloneRecords.deletedAt),
        isNotNull(schema.cloneRecords.consentSignedAt),
        isNotNull(schema.cloneRecords.consentDocumentKey),
        isNotNull(schema.cloneRecords.trainingOptoutDocumentKey),
        isNotNull(schema.cloneRecords.trainingOptoutConfirmedAt)
      )
    )
    .returning({ id: schema.cloneRecords.id });
  if (!row) throw new CloneRuleError("Der KI-Klon wurde inzwischen geändert. Bitte die Seite neu laden.");

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "clone_record",
    entityId: input.id,
    diff: { step: "modell", modelCreatedAt: input.at.toISOString(), tool: rec.tool },
  });
}

export interface RevocationResult {
  revokedAt: Date;
  /** Clone posts of the Praxis that are "zu stoppen" now (flagged now or earlier). */
  postsToStop: number;
  /** Posts this revocation flagged itself. */
  newlyFlagged: number;
  mail: "sent" | "duplicate" | "suppressed" | "no_recipient" | "failed";
}

/**
 * Revocation of the consent. Irreversible: there is no undo. One transaction
 * sets revoked_at and flags every clone post not yet stopped; the e-mail to
 * EINS goes out after the commit (a mail failure never undoes the flags,
 * the admin home shows them either way).
 */
export async function revokeClone(
  admin: AdminActor,
  input: { clinicId: string; id: string; note: string }
): Promise<RevocationResult> {
  const note = input.note.trim();
  if (!note) throw new CloneRuleError("Bitte notieren Sie, wie und wann der Widerruf eingegangen ist.");

  const result = await db.transaction(async (tx) => {
    const [rec] = await tx
      .update(schema.cloneRecords)
      .set({ revokedAt: sql`now()`, revokedNote: note, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.cloneRecords.id, input.id),
          eq(schema.cloneRecords.clinicId, input.clinicId),
          isNull(schema.cloneRecords.revokedAt)
        )
      )
      .returning();
    if (!rec) return null;
    const revokedAt = rec.revokedAt as Date;

    const candidates = await tx
      .select({
        id: schema.contentItems.id,
        usesClone: schema.contentItems.usesClone,
        status: schema.contentItems.status,
        stopRequestedAt: schema.contentItems.stopRequestedAt,
      })
      .from(schema.contentItems)
      .where(and(eq(schema.contentItems.clinicId, input.clinicId), eq(schema.contentItems.usesClone, true)))
      .for("update");
    const toStop = postsToStopOnRevocation(
      candidates.map((c) => ({ ...c, status: (isContentStatus(c.status) ? c.status : "entwurf") as ContentStatus }))
    );
    // Unknown status strings never happen (CHECK); mapping them to a
    // non-stopped status errs on the side of stopping.
    const fresh = toStop.filter((c) => !c.stopRequestedAt).map((c) => c.id);
    // Nothing of a post that is not live is online: stop it at once and
    // withdraw its open approval, so nobody can approve or publish it after
    // the revocation. Live posts stay flagged until EINS has taken them down.
    const notLive = toStop.filter((c) => c.status !== "live").map((c) => c.id);
    for (const id of notLive) await withdrawOpenApproval(tx, id);
    if (notLive.length > 0) {
      await tx
        .update(schema.contentItems)
        .set({
          status: "gestoppt",
          stopReason: revocationStopReason(revokedAt),
          stopRequestedAt: sql`coalesce(${schema.contentItems.stopRequestedAt}, ${revokedAt.toISOString()}::timestamptz)`,
          stopRequestedReason: sql`coalesce(${schema.contentItems.stopRequestedReason}, ${revocationStopReason(revokedAt)})`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(schema.contentItems.clinicId, input.clinicId), inArray(schema.contentItems.id, notLive)));
    }
    if (fresh.length > 0) {
      await tx
        .update(schema.contentItems)
        .set({ stopRequestedAt: revokedAt, stopRequestedReason: revocationStopReason(revokedAt) })
        .where(
          and(
            eq(schema.contentItems.clinicId, input.clinicId),
            inArray(schema.contentItems.id, fresh),
            isNull(schema.contentItems.stopRequestedAt)
          )
        );
    }
    return { rec, revokedAt, postsToStop: toStop.length, newlyFlagged: fresh.length, liveToStop: toStop.length - notLive.length };
  });

  if (!result) {
    await loadRecord(input.clinicId, input.id);
    throw new CloneRuleError("Der Widerruf ist schon erfasst.");
  }

  // The mail counts what EINS still has to take down by hand: the live posts.
  const mail = await mailRevocation(input.clinicId, result.rec, result.revokedAt, note, result.liveToStop);

  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "clone_record",
    entityId: input.id,
    diff: {
      step: "widerruf",
      revokedAt: result.revokedAt.toISOString(),
      note,
      postsToStop: result.postsToStop,
      newlyFlagged: result.newlyFlagged,
      mail,
    },
  });

  return { revokedAt: result.revokedAt, postsToStop: result.postsToStop, newlyFlagged: result.newlyFlagged, mail };
}

async function mailRevocation(
  clinicId: string,
  rec: CloneRecord,
  revokedAt: Date,
  note: string,
  postCount: number
): Promise<RevocationResult["mail"]> {
  const to = operatorRecipient(process.env.OPS_ALERT_EMAIL, env.ADMIN_EMAILS);
  if (!to) {
    console.warn(
      `[clone] OPS_ALERT_EMAIL and ADMIN_EMAILS are empty: revocation not mailed (clinic=${clinicId} record=${rec.id})`
    );
    return "no_recipient";
  }
  try {
    const [clinic] = await db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1);
    const { subject, text } = revocationMail({
      clinicName: clinic?.displayName ?? clinicId,
      personName: rec.personName,
      tool: rec.tool,
      revokedAt,
      note,
      postCount,
      adminLink: `${adminOrigin()}/admin/clinics/${encodeURIComponent(clinicId)}?tab=klon`,
    });
    return await sendEmailOnce({ key: `clone-revocation/${rec.id}`, clinicId: null, to, subject, text });
  } catch (err) {
    console.error(`[clone] revocation mail failed (clinic=${clinicId} record=${rec.id}):`, err);
    return "failed";
  }
}

/** The model is deleted at the tool. Final: nothing changes afterwards. */
export async function markDeleted(
  admin: AdminActor,
  input: { clinicId: string; id: string; note: string }
): Promise<void> {
  const note = input.note.trim();
  if (!note) throw new CloneRuleError("Bitte notieren Sie, wo und wie gelöscht wurde.");
  const [row] = await db
    .update(schema.cloneRecords)
    .set({ deletedAt: sql`now()`, deletedNote: note, updatedAt: sql`now()` })
    .where(
      and(
        eq(schema.cloneRecords.id, input.id),
        eq(schema.cloneRecords.clinicId, input.clinicId),
        isNull(schema.cloneRecords.deletedAt)
      )
    )
    .returning({ id: schema.cloneRecords.id, contractEndOn: schema.cloneRecords.contractEndOn });
  if (!row) {
    await loadRecord(input.clinicId, input.id);
    throw new CloneRuleError("Die Löschung ist schon vermerkt.");
  }
  await writeAudit({
    clinicId: input.clinicId,
    actorEmail: admin.email,
    action: "delete",
    entityKind: "clone_record",
    entityId: input.id,
    diff: { step: "geloescht", note, contractEndOn: row.contractEndOn },
  });
}
