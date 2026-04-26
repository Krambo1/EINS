"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { enqueueEmail } from "@/server/jobs";

/**
 * Resolve an upgrade request. When approved we also flip the clinic onto
 * the "erweitert" plan and reset planStartedAt so the billing cycle begins
 * today. We notify the requester by email either way.
 */

const ResolveSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["bearbeitet", "abgelehnt"]),
  karamNote: z.string().max(2000).optional().or(z.literal("")),
});

export async function resolveUpgradeRequestAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = ResolveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("validation failed: " + parsed.error.issues[0]?.message);
  }
  const { id, decision, karamNote } = parsed.data;

  const [req] = await db
    .select()
    .from(schema.upgradeRequests)
    .where(eq(schema.upgradeRequests.id, id))
    .limit(1);
  if (!req) throw new Error("upgrade_request_not_found");
  if (req.status !== "offen") throw new Error("already_resolved");

  const [requester] = await db
    .select()
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, req.requestedBy))
    .limit(1);

  await db
    .update(schema.upgradeRequests)
    .set({
      status: decision,
      karamNote: karamNote || null,
      resolvedAt: new Date(),
      resolvedByAdminEmail: admin.email,
    })
    .where(eq(schema.upgradeRequests.id, id));

  if (decision === "bearbeitet") {
    await db
      .update(schema.clinics)
      .set({ plan: "erweitert", planStartedAt: new Date() })
      .where(eq(schema.clinics.id, req.clinicId));
  }

  await writeAudit({
    clinicId: req.clinicId,
    actorEmail: admin.email,
    action: "update",
    entityKind: "upgrade_request",
    entityId: id,
    diff: { status: { from: "offen", to: decision } },
  });

  if (requester?.email) {
    const subject =
      decision === "bearbeitet"
        ? "Ihr Upgrade wurde freigeschaltet"
        : "Ihre Upgrade-Anfrage";
    const text =
      decision === "bearbeitet"
        ? `Hallo${requester.fullName ? " " + requester.fullName : ""},\n\nIhr Plan wurde auf "Erweitert" umgestellt. Die zusätzlichen Funktionen sind ab sofort verfügbar.\n\n${karamNote ? "Anmerkung: " + karamNote + "\n\n" : ""}Viele Grüße\nEINS Visuals`
        : `Hallo${requester.fullName ? " " + requester.fullName : ""},\n\nwir melden uns zu Ihrer Upgrade-Anfrage. Wir können das Upgrade aktuell nicht bestätigen.\n\n${karamNote ? "Anmerkung: " + karamNote + "\n\n" : ""}Bei Fragen antworten Sie gern direkt auf diese E-Mail.\n\nViele Grüße\nEINS Visuals`;
    await enqueueEmail({ to: requester.email, subject, text });
  }

  revalidatePath("/admin/operations");
  revalidatePath("/admin");
}
