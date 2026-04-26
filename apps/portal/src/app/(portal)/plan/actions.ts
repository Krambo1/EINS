"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { can, ForbiddenError } from "@/lib/roles";
import { sendUpgradeRequestEmail } from "@/server/email";
import { PLAN_LABELS } from "@/lib/constants";

const Input = z.object({
  note: z.string().max(2000).optional(),
});

/**
 * Inhaber requests an upgrade to the Erweitert package.
 * We create an upgrade_requests row (idempotent: if one is already open, we
 * just update the note) and notify Karam by email.
 */
export async function requestUpgradeAction(formData: FormData) {
  const session = await requireSession();
  if (!can(session.role, "plan.request_upgrade")) {
    throw new ForbiddenError("plan.request_upgrade");
  }
  const input = Input.parse({
    note: formData.get("note") ?? undefined,
  });

  // Fetch clinic + any open request.
  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);
  if (!clinic) throw new Error("Praxis nicht gefunden.");

  if (clinic.plan === "erweitert") {
    throw new Error("Sie haben bereits das Erweitert-Paket.");
  }

  let requestId: string;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [openRow] = await tx
      .select()
      .from(schema.upgradeRequests)
      .where(eq(schema.upgradeRequests.status, "offen"))
      .orderBy(desc(schema.upgradeRequests.requestedAt))
      .limit(1);

    if (openRow) {
      await tx
        .update(schema.upgradeRequests)
        .set({ userNote: input.note ?? null, requestedAt: new Date() })
        .where(eq(schema.upgradeRequests.id, openRow.id));
      requestId = openRow.id;
    } else {
      const [row] = await tx
        .insert(schema.upgradeRequests)
        .values({
          clinicId: session.clinicId,
          requestedBy: session.userId,
          userNote: input.note ?? null,
        })
        .returning({ id: schema.upgradeRequests.id });
      requestId = row!.id;
    }
  });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "request_upgrade",
    entityKind: "upgrade_request",
    entityId: requestId!,
    diff: { note: input.note },
  });

  // Best-effort notification.
  try {
    await sendUpgradeRequestEmail({
      to: "karam@einsvisuals.com",
      clinicName: clinic.displayName,
      requestedBy: session.email,
      currentPlan: PLAN_LABELS[clinic.plan as "standard" | "erweitert"] ?? clinic.plan,
      note: input.note,
    });
  } catch {
    // Swallow.
  }

  revalidatePath("/plan");
}
