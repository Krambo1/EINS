"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import {
  ContentRuleError,
  addPublication,
  assetKeyPrefix,
  createContentItem,
  isAssetUploadExtension,
  moveContentStatus,
  regenerateLinks,
  stopContentItem,
  updateContentItem,
  type ContentItemFields,
} from "@/server/content";
import { createUploadTarget, type UploadTarget } from "@/server/uploads";
import {
  ApprovalRuleError,
  acknowledgeHwgWarnings,
  runHwgCheckForItem,
  sendApprovalBatch,
  setNoBeforeAfterConfirmation,
} from "@/server/content-approval";
import { parsePublishedDay } from "@/lib/content-items";
import { CONTENT_FORMATS, CONTENT_PLATFORMS, CONTENT_STATUSES } from "@/lib/content-status";
import { fileExtension, uploadLimitForExtension } from "@/lib/uploads";

/**
 * Admin-side posts (Beiträge) for one Praxis. Same guard as
 * ./messweg-actions.ts: re-check the admin session, validate with zod; the
 * status rules are enforced in server/content.ts (ContentRuleError), audit
 * rows are written there. Form errors redirect back with ?fehler=….
 */

const TAB = "beitraege";

function tabUrl(clinicId: string, param: "fehler" | "hinweis", message: string): string {
  return `/admin/clinics/${clinicId}?tab=${TAB}&${param}=${encodeURIComponent(message)}`;
}

function failTo(clinicId: string | undefined, message: string): never {
  if (!clinicId) redirect("/admin/clinics");
  redirect(tabUrl(clinicId, "fehler", message));
}

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `Eingabe ungültig (${i.path.join(".") || "Formular"}): ${i.message}` : "Eingabe ungültig.";
}

function formClinicId(formData: FormData): string | undefined {
  const v = formData.get("clinicId");
  return typeof v === "string" && z.string().uuid().safeParse(v).success ? v : undefined;
}

function revalidate(clinicId: string) {
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin/beitraege");
  revalidatePath("/beitraege");
  revalidatePath("/medien");
}

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid().nullable());

const FieldsSchema = z.object({
  clinicId: z.string().uuid(),
  title: z.string().trim().min(1, "Titel fehlt").max(200),
  format: z.enum(CONTENT_FORMATS),
  treatmentId: optionalUuid,
  assetId: optionalUuid,
  caption: z
    .string()
    .max(5000)
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  usesClone: z.string().optional().transform((v) => v === "on"),
  aiContent: z.string().optional().transform((v) => v === "on"),
});

function fields(d: z.infer<typeof FieldsSchema>): ContentItemFields {
  return {
    title: d.title,
    format: d.format,
    treatmentId: d.treatmentId,
    usesClone: d.usesClone,
    aiContent: d.aiContent,
    caption: d.caption,
    assetId: d.assetId,
  };
}

/** Runs a write; rule errors go back to the tab, anything else is a real error. */
async function run<T>(clinicId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ContentRuleError || err instanceof ApprovalRuleError) failTo(clinicId, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------
// Create (called from the client form, optionally after an upload)
// ---------------------------------------------------------------

export type BeitragActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const UploadTargetInput = z.object({
  clinicId: z.string().uuid(),
  name: z.string().min(1).max(300),
  size: z.number().int().positive(),
  type: z.string().max(200),
});

export async function createBeitragUploadTargetAction(
  input: z.infer<typeof UploadTargetInput>
): Promise<BeitragActionResult<UploadTarget>> {
  await requireAdmin();
  const parsed = UploadTargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Eingabe ungültig." };
  const ext = fileExtension(parsed.data.name);
  if (!isAssetUploadExtension(ext)) {
    return { ok: false, error: "Nur Videos (mp4, mov, webm, m4v) und Bilder (png, jpg, webp, heic, gif) sind erlaubt." };
  }
  if (parsed.data.size > uploadLimitForExtension(ext)) {
    return { ok: false, error: "Die Datei ist zu groß (Videos bis 2 GB, Bilder bis 100 MB)." };
  }
  const target = await createUploadTarget({
    clinicId: parsed.data.clinicId,
    scope: "assets",
    extension: ext,
    contentType: parsed.data.type,
  });
  return { ok: true, data: target };
}

export async function createBeitragAction(formData: FormData): Promise<BeitragActionResult<{ code: string; linksBuilt: boolean }>> {
  const admin = await requireAdmin();
  const parsed = FieldsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const uploadKey = formData.get("uploadKey");
  const uploadName = formData.get("uploadName");
  let upload: { key: string; filename: string } | null = null;
  if (typeof uploadKey === "string" && uploadKey) {
    if (!uploadKey.startsWith(assetKeyPrefix(d.clinicId)) || uploadKey.length > 500) {
      return { ok: false, error: "Die hochgeladene Datei gehört nicht zu dieser Praxis." };
    }
    upload = { key: uploadKey, filename: typeof uploadName === "string" ? uploadName.slice(0, 300) : uploadKey };
  }

  try {
    const created = await createContentItem(admin, { clinicId: d.clinicId, ...fields(d), upload });
    revalidate(d.clinicId);
    return { ok: true, data: { code: created.code, linksBuilt: created.linksBuilt } };
  } catch (err) {
    if (err instanceof ContentRuleError) return { ok: false, error: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------
// Edit
// ---------------------------------------------------------------

const UpdateSchema = FieldsSchema.extend({ id: z.string().uuid() });

export async function updateBeitragAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = UpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  await run(d.clinicId, () => updateContentItem(admin, { clinicId: d.clinicId, id: d.id, ...fields(d) }));
  revalidate(d.clinicId);
  redirect(tabUrl(d.clinicId, "hinweis", `Beitrag „${d.title}“ gespeichert.`));
}

// ---------------------------------------------------------------
// Status
// ---------------------------------------------------------------

const MoveSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  to: z.enum(CONTENT_STATUSES),
});

export async function moveBeitragStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = MoveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  // Stopping goes through its own form (reason required).
  if (d.to === "gestoppt") failTo(d.clinicId, "Zum Stoppen bitte „Stoppen“ mit Grund verwenden.");
  await run(d.clinicId, () => moveContentStatus(admin, { clinicId: d.clinicId, id: d.id, to: d.to }));
  revalidate(d.clinicId);
}

const StopSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  reason: z.string().trim().min(1, "Grund fehlt").max(500),
});

export async function stopBeitragAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = StopSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), "Zum Stoppen bitte einen Grund angeben (höchstens 500 Zeichen).");
  const d = parsed.data;
  await run(d.clinicId, () => stopContentItem(admin, { clinicId: d.clinicId, id: d.id, reason: d.reason }));
  revalidate(d.clinicId);
  redirect(tabUrl(d.clinicId, "hinweis", "Beitrag gestoppt."));
}

// ---------------------------------------------------------------
// Permalink
// ---------------------------------------------------------------

const PublicationSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  platform: z.enum(CONTENT_PLATFORMS),
  permalink: z.string().trim().min(1, "Permalink fehlt").max(500),
  publishedAt: z.string().trim(),
});

export async function addPublicationAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = PublicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  const publishedAt = parsePublishedDay(d.publishedAt);
  if (!publishedAt) failTo(d.clinicId, "Das Datum der Veröffentlichung fehlt oder liegt in der Zukunft.");
  await run(d.clinicId, () =>
    addPublication(admin, { clinicId: d.clinicId, id: d.id, platform: d.platform, permalink: d.permalink, publishedAt })
  );
  revalidate(d.clinicId);
  redirect(tabUrl(d.clinicId, "hinweis", "Permalink eingetragen, der Beitrag ist live."));
}

// ---------------------------------------------------------------
// Links
// ---------------------------------------------------------------

const IdSchema = z.object({ clinicId: z.string().uuid(), id: z.string().uuid() });

export async function regenerateBeitragLinksAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = IdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  await run(d.clinicId, () => regenerateLinks(admin, { clinicId: d.clinicId, id: d.id }));
  revalidate(d.clinicId);
}

// ---------------------------------------------------------------
// Prüf-Schranke and Freigabe-Paket (Phase 4)
// ---------------------------------------------------------------

const HWG_VERDICT_HINTS: Record<"clean" | "warn" | "violation", string> = {
  clean: "HWG-Prüfung ohne Treffer.",
  warn: "HWG-Prüfung mit Hinweisen. Bitte lesen und namentlich bestätigen.",
  violation: "HWG-Prüfung hat einen Verstoß gefunden. Bitte den Beitragstext ändern.",
};

export async function runHwgCheckAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = IdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  const verdict = await run(d.clinicId, () => runHwgCheckForItem(admin, { clinicId: d.clinicId, id: d.id }));
  revalidate(d.clinicId);
  redirect(tabUrl(d.clinicId, verdict === "violation" ? "fehler" : "hinweis", HWG_VERDICT_HINTS[verdict]));
}

export async function acknowledgeHwgWarningsAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = IdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  await run(d.clinicId, () => acknowledgeHwgWarnings(admin, { clinicId: d.clinicId, id: d.id }));
  revalidate(d.clinicId);
}

const ConfirmSchema = IdSchema.extend({
  confirmed: z.enum(["1", "0"]),
  /** The checkbox; required when confirming. */
  check: z.string().optional(),
});

export async function setNoBeforeAfterAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = ConfirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  const confirmed = d.confirmed === "1";
  if (confirmed && d.check !== "on") failTo(d.clinicId, "Bitte das Kästchen ankreuzen, um zu bestätigen.");
  await run(d.clinicId, () => setNoBeforeAfterConfirmation(admin, { clinicId: d.clinicId, id: d.id, confirmed }));
  revalidate(d.clinicId);
}

export async function sendApprovalBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const clinicId = formClinicId(formData);
  if (!clinicId) failTo(undefined, "Praxis fehlt.");
  const ids = formData.getAll("itemIds").filter((v): v is string => typeof v === "string");
  if (ids.length === 0 || !ids.every((v) => z.string().uuid().safeParse(v).success)) {
    failTo(clinicId, "Bitte mindestens einen Beitrag auswählen.");
  }
  const { batch, mail } = await run(clinicId, () => sendApprovalBatch(admin, clinicId, ids));
  const parts = [
    `Freigabe-Paket mit ${batch.posts.length} ${batch.posts.length === 1 ? "Beitrag" : "Beiträgen"} gesendet.`,
    mail.sent.length + mail.duplicate.length > 0
      ? `E-Mail an ${[...mail.sent, ...mail.duplicate].join(", ")}.`
      : "Keine E-Mail zugestellt.",
  ];
  if (mail.failed.length > 0) parts.push(`Fehlgeschlagen: ${mail.failed.join(", ")}.`);
  if (mail.suppressed.length > 0) parts.push(`Gesperrt (Bounce oder Beschwerde): ${mail.suppressed.join(", ")}.`);
  if (mail.postsWithoutRecipient.length > 0) {
    parts.push(
      `Ohne Empfänger: ${mail.postsWithoutRecipient.map((t) => `„${t}“`).join(", ")} (Klon-Beiträge gehen nur an Inhaber-Zugänge).`
    );
  }
  if (mail.failed.length + mail.suppressed.length + mail.postsWithoutRecipient.length > 0) {
    parts.push("Die Praxis kann im Portal unter Beiträge entscheiden.");
  }
  revalidate(clinicId);
  redirect(tabUrl(clinicId, "hinweis", parts.join(" ")));
}
