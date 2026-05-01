"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { eraseClinicData } from "@/server/dsgvo";

/**
 * Hard-delete all data for a clinic per Art. 17 DSGVO.
 *
 * Guardrails:
 *  - Admin auth + MFA (requireAdmin default enforces both).
 *  - Confirmation must echo the clinic slug — prevents muscle-memory mis-clicks.
 *  - Writes the audit row BEFORE erasure so the paper trail isn't deleted
 *    along with the clinic.
 */
const EraseSchema = z.object({
  id: z.string().uuid(),
  confirmSlug: z.string().min(1),
});

export async function eraseClinicDataAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = EraseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");

  const [clinic] = await db
    .select({ slug: schema.clinics.slug, displayName: schema.clinics.displayName })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, parsed.data.id))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");

  if (parsed.data.confirmSlug.trim() !== clinic.slug) {
    throw new Error("confirmation_mismatch");
  }

  // Write audit FIRST so it outlives the erasure (auditLog has no FK).
  await writeAudit({
    clinicId: parsed.data.id,
    actorEmail: admin.email,
    action: "delete",
    entityKind: "dsgvo_erasure",
    entityId: parsed.data.id,
    diff: { slug: clinic.slug, displayName: clinic.displayName },
  });

  await eraseClinicData(parsed.data.id);

  redirect("/admin/clinics");
}
