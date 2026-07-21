"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";
import { getStorage } from "@/server/storage";
import {
  createUploadTarget,
  verifyUploadedObject,
  type UploadTarget,
} from "@/server/uploads";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import {
  CHECKLIST_ITEMS_BY_ID,
  MAX_CHECKLIST_UPLOAD_BYTES,
  UPLOAD_PROFILES,
  itemAcceptsLink,
  itemAcceptsUpload,
  validateChecklistFields,
  type ChecklistAnswer,
  type ChecklistItem,
  type ChecklistStatus,
} from "./content";

/**
 * Clinic-side actions for the Asset-Liefer-Checkliste. All gate on
 * `onboarding.complete` (inhaber-only in v1, like the rest of /onboarding) and
 * write through `withClinicContext` so RLS scopes every row to the caller's
 * clinic.
 *
 * Two-stage status: these actions only ever set 'offen' / 'geliefert' /
 * 'entfaellt'. EINS sets 'geprueft' in the admin. Re-delivering a verified item
 * (new file, removed file, changed answer) drops it back to 'geliefert' and
 * clears the verification so EINS re-checks; a genuine no-op save keeps it.
 */

const RESULT_OK = { ok: true } as const;

export type ChecklistActionResult =
  | { ok: true; status?: ChecklistStatus }
  | { ok: false; error: string; field?: string };

// ---------------------------------------------------------------
// Pure status logic
// ---------------------------------------------------------------

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function anyFieldFilled(item: ChecklistItem, answer: ChecklistAnswer): boolean {
  return (item.fields ?? []).some((f) => nonEmpty(answer[f.key]));
}

function angabeComplete(item: ChecklistItem, answer: ChecklistAnswer): boolean {
  const required = (item.fields ?? []).filter((f) => !f.optional);
  if (required.length > 0) return required.every((f) => nonEmpty(answer[f.key]));
  return anyFieldFilled(item, answer);
}

/** Clinic-side delivery status, derived from the item type + its inputs. */
function computeDeliveryStatus(
  item: ChecklistItem,
  answer: ChecklistAnswer,
  fileCount: number,
  selfChecked: boolean,
  nichtVorhanden: boolean
): ChecklistStatus {
  if (nichtVorhanden && item.allowNichtVorhanden) return "entfaellt";
  switch (item.deliveryType) {
    case "status":
    case "einladung":
      return selfChecked ? "geliefert" : "offen";
    case "upload":
      return fileCount > 0 ? "geliefert" : "offen";
    case "link":
      return nonEmpty(answer.link) ? "geliefert" : "offen";
    case "upload_oder_link":
      if (
        fileCount > 0 ||
        nonEmpty(answer.link) ||
        answer.keineVorhanden === true ||
        anyFieldFilled(item, answer)
      ) {
        return "geliefert";
      }
      return "offen";
    case "angabe":
      return angabeComplete(item, answer) ? "geliefert" : "offen";
  }
}

/** Keep only known keys, trim strings, coerce flags; drops empties. */
function sanitizeAnswer(
  item: ChecklistItem,
  raw: Record<string, string | boolean> | undefined
): ChecklistAnswer {
  const out: ChecklistAnswer = {};
  const fieldKeys = new Set((item.fields ?? []).map((f) => f.key));
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k === "link" && itemAcceptsLink(item.deliveryType)) {
      if (typeof v === "string" && v.trim()) out.link = v.trim().slice(0, 2000);
    } else if (k === "keineVorhanden" && item.allowKeineVorhanden) {
      if (v === true) out.keineVorhanden = true;
    } else if (fieldKeys.has(k)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 8000);
    }
  }
  return out;
}

// ---------------------------------------------------------------
// saveChecklistItem — angaben, link, self-checks, "nicht vorhanden"
// ---------------------------------------------------------------

const SaveInput = z.object({
  itemId: z.string().max(8),
  answer: z
    .record(z.string(), z.union([z.string().max(8000), z.boolean()]))
    .default({}),
  selfChecked: z.boolean().optional(),
  nichtVorhanden: z.boolean().optional(),
});

export async function saveChecklistItem(
  input: z.infer<typeof SaveInput>
): Promise<ChecklistActionResult> {
  const session = await requireSession();
  if (!can(session.role, "onboarding.complete")) {
    throw new ForbiddenError("onboarding.complete");
  }
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const item = CHECKLIST_ITEMS_BY_ID.get(parsed.data.itemId);
  if (!item) return { ok: false, error: "unknown_item" };

  const answer = sanitizeAnswer(item, parsed.data.answer);

  // Source of truth for contact-field quality: reject malformed email/phone
  // values before anything persists, so garbage never reaches the admin verify
  // view or EINS's downstream outreach. Field-level German error.
  const fieldErrors = validateChecklistFields(item, answer);
  const firstError = Object.entries(fieldErrors)[0];
  if (firstError) {
    return { ok: false, error: firstError[1], field: firstError[0] };
  }

  const selfChecked = parsed.data.selfChecked ?? false;
  const nichtVorhanden = parsed.data.nichtVorhanden ?? false;

  let finalStatus: ChecklistStatus = "offen";
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.checklistItems)
      .where(
        and(
          eq(schema.checklistItems.clinicId, session.clinicId),
          eq(schema.checklistItems.itemId, item.id)
        )
      )
      .limit(1);

    const [fc] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.checklistFiles)
      .where(
        and(
          eq(schema.checklistFiles.clinicId, session.clinicId),
          eq(schema.checklistFiles.itemId, item.id)
        )
      );
    const fileCount = fc?.n ?? 0;

    const computed = computeDeliveryStatus(
      item,
      answer,
      fileCount,
      selfChecked,
      nichtVorhanden
    );

    // Preserve EINS verification on a true no-op; any real change re-opens it.
    const prevAnswer = (existing?.answer ?? {}) as ChecklistAnswer;
    const answerChanged =
      JSON.stringify(prevAnswer) !== JSON.stringify(answer);

    let status = computed;
    let clearVerified = false;
    if (existing?.status === "geprueft") {
      if (!answerChanged && computed === "geliefert") {
        status = "geprueft";
      } else {
        clearVerified = true;
      }
    }

    const now = new Date();
    const delivered =
      status === "geliefert" || status === "entfaellt" || status === "geprueft";
    const values = {
      answer,
      status,
      deliveredAt: delivered ? existing?.deliveredAt ?? now : null,
      deliveredBy: delivered ? existing?.deliveredBy ?? session.userId : null,
      updatedAt: now,
      updatedBy: session.userId,
      ...(clearVerified ? { verifiedAt: null, verifiedBy: null } : {}),
    };

    if (existing) {
      await tx
        .update(schema.checklistItems)
        .set(values)
        .where(eq(schema.checklistItems.id, existing.id));
    } else {
      await tx
        .insert(schema.checklistItems)
        .values({ clinicId: session.clinicId, itemId: item.id, ...values });
    }
    finalStatus = status;
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "save_checklist_item",
    entityKind: "checklist_item",
    diff: { itemId: item.id, status: finalStatus },
  });

  revalidatePath("/onboarding/checkliste");
  revalidatePath("/onboarding");
  return { ok: true, status: finalStatus };
}

// ---------------------------------------------------------------
// Checklist file uploads — direct-to-storage in two steps.
//
// The bytes never transit a server action: Vercel caps request bodies at
// ~4.5 MB, so the old FormData upload silently broke for anything bigger
// than a screenshot. createChecklistUploadTargetAction validates and mints
// a storage target (R2 presigned PUT in prod, /api/uploads locally); the
// browser uploads directly; finalizeChecklistFileAction verifies the object
// landed and writes the DB row + delivery status.
// ---------------------------------------------------------------

const TargetInput = z.object({
  itemId: z.string().max(8),
  filename: z.string().min(1).max(300),
  size: z.number().int().positive(),
  contentType: z.string().max(200).optional(),
});

export type ChecklistTargetResult =
  | { ok: true; target: UploadTarget }
  | { ok: false; error: string };

export async function createChecklistUploadTargetAction(
  input: z.infer<typeof TargetInput>
): Promise<ChecklistTargetResult> {
  const session = await requireSession();
  if (!can(session.role, "onboarding.complete")) {
    throw new ForbiddenError("onboarding.complete");
  }
  const parsed = TargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const item = CHECKLIST_ITEMS_BY_ID.get(parsed.data.itemId);
  if (!item || !itemAcceptsUpload(item.deliveryType)) {
    return { ok: false, error: "unknown_item" };
  }
  if (parsed.data.size > MAX_CHECKLIST_UPLOAD_BYTES) {
    return { ok: false, error: "file_too_large" };
  }

  const profile = item.uploadProfile
    ? UPLOAD_PROFILES[item.uploadProfile]
    : null;
  const ext = (parsed.data.filename.split(".").pop() ?? "").toLowerCase();
  if (profile && (!ext || !profile.extensions.includes(ext))) {
    return { ok: false, error: "bad_type" };
  }

  const target = await createUploadTarget({
    clinicId: session.clinicId,
    scope: `checklist/${item.id}`,
    extension: ext,
    contentType: parsed.data.contentType,
  });
  return { ok: true, target };
}

const FinalizeInput = z.object({
  itemId: z.string().max(8),
  key: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  contentType: z.string().max(200).optional(),
});

export async function finalizeChecklistFileAction(
  input: z.infer<typeof FinalizeInput>
): Promise<ChecklistActionResult> {
  const session = await requireSession();
  if (!can(session.role, "onboarding.complete")) {
    throw new ForbiddenError("onboarding.complete");
  }
  const parsed = FinalizeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const item = CHECKLIST_ITEMS_BY_ID.get(parsed.data.itemId);
  if (!item || !itemAcceptsUpload(item.deliveryType)) {
    return { ok: false, error: "unknown_item" };
  }

  // The client may only finalize keys inside its own namespace for this item.
  const prefix = `${session.clinicId}/checklist/${item.id}/`;
  const storageKey = parsed.data.key;
  if (!storageKey.startsWith(prefix) || storageKey.includes("..")) {
    return { ok: false, error: "invalid" };
  }
  // Never trust the client that bytes arrived — check storage.
  const head = await verifyUploadedObject(storageKey);
  if (!head) return { ok: false, error: "no_file" };
  if (head.size > MAX_CHECKLIST_UPLOAD_BYTES) {
    // Belt & braces: the target minting capped size, but the object is
    // what counts. Drop an oversized stray instead of registering it.
    await getStorage().remove(storageKey);
    return { ok: false, error: "file_too_large" };
  }

  const file = {
    name: parsed.data.filename,
    type: head.contentType ?? parsed.data.contentType ?? null,
    size: head.size,
  };

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    // Idempotent against a double-finalize (retry, double-click).
    const [dupe] = await tx
      .select({ id: schema.checklistFiles.id })
      .from(schema.checklistFiles)
      .where(eq(schema.checklistFiles.storageKey, storageKey))
      .limit(1);
    if (dupe) return;

    await tx.insert(schema.checklistFiles).values({
      clinicId: session.clinicId,
      itemId: item.id,
      storageKey,
      originalFilename: file.name.slice(0, 300),
      contentType: file.type,
      sizeBytes: file.size,
      uploadedBy: session.userId,
    });

    const [existing] = await tx
      .select()
      .from(schema.checklistItems)
      .where(
        and(
          eq(schema.checklistItems.clinicId, session.clinicId),
          eq(schema.checklistItems.itemId, item.id)
        )
      )
      .limit(1);

    const now = new Date();
    // A new file is a delivery; if EINS had verified, reset for re-check.
    const base = {
      status: "geliefert" as const,
      deliveredAt: existing?.deliveredAt ?? now,
      deliveredBy: existing?.deliveredBy ?? session.userId,
      updatedAt: now,
      updatedBy: session.userId,
      verifiedAt: null,
      verifiedBy: null,
    };
    if (existing) {
      await tx
        .update(schema.checklistItems)
        .set(base)
        .where(eq(schema.checklistItems.id, existing.id));
    } else {
      await tx
        .insert(schema.checklistItems)
        .values({
          clinicId: session.clinicId,
          itemId: item.id,
          answer: {},
          ...base,
        });
    }
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "upload",
    entityKind: "checklist_file",
    diff: { itemId: item.id, filename: file.name, size: file.size },
  });

  revalidatePath("/onboarding/checkliste");
  revalidatePath("/onboarding");
  return RESULT_OK;
}

// ---------------------------------------------------------------
// removeChecklistFile
// ---------------------------------------------------------------

export async function removeChecklistFile(input: {
  fileId: string;
}): Promise<ChecklistActionResult> {
  const session = await requireSession();
  if (!can(session.role, "onboarding.complete")) {
    throw new ForbiddenError("onboarding.complete");
  }
  const fileId = z.string().uuid().safeParse(input.fileId);
  if (!fileId.success) return { ok: false, error: "invalid" };

  let storageKey: string | null = null;
  let itemIdForAudit: string | null = null;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.checklistFiles)
      .where(
        and(
          eq(schema.checklistFiles.id, fileId.data),
          eq(schema.checklistFiles.clinicId, session.clinicId)
        )
      )
      .limit(1);
    if (!row) return;
    storageKey = row.storageKey;
    itemIdForAudit = row.itemId;

    await tx
      .delete(schema.checklistFiles)
      .where(eq(schema.checklistFiles.id, row.id));

    const item = CHECKLIST_ITEMS_BY_ID.get(row.itemId);
    const [existing] = await tx
      .select()
      .from(schema.checklistItems)
      .where(
        and(
          eq(schema.checklistItems.clinicId, session.clinicId),
          eq(schema.checklistItems.itemId, row.itemId)
        )
      )
      .limit(1);
    const [fc] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.checklistFiles)
      .where(
        and(
          eq(schema.checklistFiles.clinicId, session.clinicId),
          eq(schema.checklistFiles.itemId, row.itemId)
        )
      );
    const fileCount = fc?.n ?? 0;

    if (item && existing) {
      const answer = (existing.answer ?? {}) as ChecklistAnswer;
      // Only upload/upload_oder_link items have files, so the self-check and
      // "nicht vorhanden" flags are irrelevant here.
      const computed = computeDeliveryStatus(item, answer, fileCount, false, false);
      const now = new Date();
      const delivered = computed === "geliefert" || computed === "entfaellt";
      await tx
        .update(schema.checklistItems)
        .set({
          status: computed,
          deliveredAt: delivered ? existing.deliveredAt : null,
          deliveredBy: delivered ? existing.deliveredBy : null,
          updatedAt: now,
          updatedBy: session.userId,
          verifiedAt: null,
          verifiedBy: null,
        })
        .where(eq(schema.checklistItems.id, existing.id));
    }
  });

  if (storageKey) await getStorage().remove(storageKey);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entityKind: "checklist_file",
    diff: { itemId: itemIdForAudit, fileId: fileId.data },
  });

  revalidatePath("/onboarding/checkliste");
  revalidatePath("/onboarding");
  return RESULT_OK;
}
