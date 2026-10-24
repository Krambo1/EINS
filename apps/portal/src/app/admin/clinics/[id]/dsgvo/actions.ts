"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { revalidatePath } from "next/cache";
import { eraseClinicData } from "@/server/dsgvo";

/**
 * Hard-delete all data for a clinic per Art. 17 DSGVO.
 *
 * Guardrails:
 *  - Admin auth (requireAdmin enforces session + allowlist).
 *  - Confirmation must echo the clinic slug (case-insensitive) — prevents
 *    muscle-memory mis-clicks.
 *  - The `dsgvo_erasure` audit row is written by eraseClinicData INSIDE the
 *    deletion transaction (G-03): no "gelöscht" entry without a deletion.
 *  - Input errors redirect back with ?fehler= instead of the error page (G-20).
 */
const EraseSchema = z.object({
  id: z.string().uuid(),
  confirmSlug: z.string().min(1),
});

export async function eraseClinicDataAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = EraseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/clinics");
  const back = `/admin/clinics/${parsed.data.id}/dsgvo`;

  const [clinic] = await db
    .select({ slug: schema.clinics.slug, displayName: schema.clinics.displayName })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, parsed.data.id))
    .limit(1);
  if (!clinic) redirect("/admin/clinics");

  if (parsed.data.confirmSlug.trim().toLowerCase() !== clinic.slug.toLowerCase()) {
    redirect(`${back}?fehler=${encodeURIComponent("Der Slug stimmt nicht. Nichts wurde gelöscht.")}`);
  }

  let result: Awaited<ReturnType<typeof eraseClinicData>>;
  try {
    result = await eraseClinicData(parsed.data.id, {
      email: admin.email,
      slug: clinic.slug,
      displayName: clinic.displayName,
    });
  } catch (err) {
    console.error("[dsgvo] erasure failed:", err instanceof Error ? err.message : err);
    redirect(
      `${back}?fehler=${encodeURIComponent(
        "Löschung fehlgeschlagen, es wurde nichts gelöscht. Details stehen im Server-Log."
      )}`
    );
  }

  revalidatePath("/admin/clinics");
  const parts = [
    result.storageFailed.length
      ? `${clinic.displayName} gelöscht. ${result.storageFailed.length} von ${result.storageKeys} Dateien konnten nicht aus dem Speicher entfernt werden (Liste im Audit-Log).`
      : `${clinic.displayName} gelöscht, dazu ${result.storageKeys} Dateien aus dem Speicher.`,
  ];
  // L-12: the folder sweep (orphaned uploads) can fail on its own.
  if (result.prefixFailed === -1) {
    parts.push("Die Praxis-Ordner im Speicher konnten nicht durchsucht werden: Die Löschung der Dateien ist unvollständig (Details im Audit-Log).");
  } else if (result.prefixFailed > 0) {
    parts.push(
      `${result.prefixFailed} weitere ${result.prefixFailed === 1 ? "Datei" : "Dateien"} in den Praxis-Ordnern konnten nicht entfernt werden: Die Löschung der Dateien ist unvollständig (Details im Audit-Log).`
    );
  }
  parts.push(
    "Sicherungen laufen nach 30 Tagen aus. Daten, die schon an Resend, Google oder Meta übermittelt wurden, sind nicht Teil dieser Löschung."
  );
  const msg = parts.join(" ");
  redirect(`/admin/clinics?hinweis=${encodeURIComponent(msg)}`);
}
