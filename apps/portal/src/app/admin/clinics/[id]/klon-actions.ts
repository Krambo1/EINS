"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import {
  CloneRuleError,
  createCloneDocumentTarget,
  createCloneRecord,
  markDeleted,
  revokeClone,
  setModelCreated,
  updateCloneRecord,
} from "@/server/clone";
import type { UploadTarget } from "@/server/uploads";
import { berlinDate, isIsoDate } from "@/lib/guarantee-clock";
import { berlinMidnight } from "@/lib/werkstunden";
import { fileExtension } from "@/lib/uploads";
import { postCountLabel } from "@/lib/clone-record";

/**
 * Admin-side KI-Klon records for one Praxis. Same guard as
 * ./messweg-actions.ts: re-check the admin session, validate with zod; the
 * rules (model gate, irreversible revocation) are enforced in
 * server/clone.ts, which also writes the audit rows. Form errors redirect
 * back with ?fehler=….
 */

const TAB = "klon";

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
  revalidatePath("/admin");
}

async function run(clinicId: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CloneRuleError) failTo(clinicId, err.message);
    throw err;
  }
}

const isoDay = z.string().refine((v) => isIsoDate(v), "Datum ungültig");

// ---------------------------------------------------------------
// Create
// ---------------------------------------------------------------

const CreateSchema = z.object({
  clinicId: z.string().uuid(),
  personName: z.string().trim().min(1, "Person fehlt").max(200),
  tool: z.string().trim().min(1, "Werkzeug fehlt").max(200),
});

export async function createKlonAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = CreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  await run(d.clinicId, async () => {
    await createCloneRecord(admin, d);
  });
  revalidate(d.clinicId);
}

// ---------------------------------------------------------------
// Documents (client form: target, upload, then save)
// ---------------------------------------------------------------

export type KlonActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const TargetInput = z.object({
  clinicId: z.string().uuid(),
  name: z.string().min(1).max(300),
  size: z.number().int().positive(),
  type: z.string().max(200),
});

export async function createKlonDocumentTargetAction(
  input: z.infer<typeof TargetInput>
): Promise<KlonActionResult<UploadTarget>> {
  await requireAdmin();
  const parsed = TargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Eingabe ungültig." };
  try {
    const target = await createCloneDocumentTarget({
      clinicId: parsed.data.clinicId,
      extension: fileExtension(parsed.data.name),
      size: parsed.data.size,
      contentType: parsed.data.type,
    });
    return { ok: true, data: target };
  } catch (err) {
    if (err instanceof CloneRuleError) return { ok: false, error: err.message };
    throw err;
  }
}

const DocumentSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  kind: z.enum(["einwilligung", "widerspruch"]),
  day: isoDay,
  documentKey: z.string().min(1).max(500),
});

export async function saveKlonDocumentAction(
  input: z.infer<typeof DocumentSchema>
): Promise<KlonActionResult<null>> {
  const admin = await requireAdmin();
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  try {
    await updateCloneRecord(
      admin,
      d.kind === "einwilligung"
        ? { clinicId: d.clinicId, id: d.id, kind: "einwilligung", signedOn: d.day, documentKey: d.documentKey }
        : { clinicId: d.clinicId, id: d.id, kind: "widerspruch", confirmedOn: d.day, documentKey: d.documentKey }
    );
  } catch (err) {
    if (err instanceof CloneRuleError) return { ok: false, error: err.message };
    throw err;
  }
  revalidate(d.clinicId);
  return { ok: true, data: null };
}

// ---------------------------------------------------------------
// Model, contract end, revocation, deletion
// ---------------------------------------------------------------

const ModelSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  day: isoDay,
});

export async function setKlonModelAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = ModelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  // Today means now (after the opt-out of today); an earlier day means its start.
  const at = d.day === berlinDate(new Date()) ? new Date() : berlinMidnight(d.day);
  await run(d.clinicId, () => setModelCreated(admin, { clinicId: d.clinicId, id: d.id, at }));
  revalidate(d.clinicId);
  redirect(tabUrl(d.clinicId, "hinweis", "Modell als angelegt vermerkt."));
}

const ContractEndSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  contractEndOn: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isIsoDate(v), "Datum ungültig"),
});

export async function setKlonContractEndAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = ContractEndSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  await run(d.clinicId, () =>
    updateCloneRecord(admin, { clinicId: d.clinicId, id: d.id, kind: "vertragsende", contractEndOn: d.contractEndOn })
  );
  revalidate(d.clinicId);
}

const NoteSchema = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid(),
  note: z.string().trim().min(1, "Notiz fehlt").max(2000),
});

export async function revokeKlonAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = NoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  let message = "";
  await run(d.clinicId, async () => {
    const r = await revokeClone(admin, d);
    const mailNote =
      r.mail === "sent" || r.mail === "duplicate"
        ? "EINS ist per E-Mail informiert."
        : "Die E-Mail an EINS ist nicht rausgegangen, bitte selbst weitergeben.";
    message = `Widerruf erfasst. ${postCountLabel(r.postsToStop)} zu stoppen. ${mailNote}`;
  });
  revalidate(d.clinicId);
  revalidatePath("/beitraege");
  redirect(tabUrl(d.clinicId, "hinweis", message));
}

export async function markKlonDeletedAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = NoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(formClinicId(formData), firstIssue(parsed.error));
  const d = parsed.data;
  await run(d.clinicId, () => markDeleted(admin, d));
  revalidate(d.clinicId);
  redirect(tabUrl(d.clinicId, "hinweis", "Löschung des KI-Klons vermerkt."));
}
