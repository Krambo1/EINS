"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { schema, withClinicContext } from "@/db/client";

/**
 * Dashboard-alert mutations: dismiss (hide forever) and snooze (hide for
 * 7 days). The scan worker won't resurrect a dismissed alert with the
 * same dedupe_key; if the underlying anomaly stops firing the worker
 * marks the row dismissed anyway, so the praxis only has to dismiss
 * things they actively don't want to act on.
 *
 * RLS does the heavy lifting: the UPDATE inside withClinicContext can
 * only touch rows where clinic_id = app_current_clinic(), so a forged
 * alertId from another tenant updates zero rows.
 */

const IdInput = z.object({ alertId: z.string().uuid() });

const SNOOZE_DAYS = 7;

export async function dismissAlertAction(formData: FormData): Promise<void> {
  const parsed = IdInput.safeParse({ alertId: formData.get("alertId") });
  if (!parsed.success) return;
  const session = await requireSession();

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.dashboardAlerts)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.dashboardAlerts.id, parsed.data.alertId),
          eq(schema.dashboardAlerts.clinicId, session.clinicId)
        )
      );
  });

  revalidatePath("/dashboard");
}

export async function snoozeAlertAction(formData: FormData): Promise<void> {
  const parsed = IdInput.safeParse({ alertId: formData.get("alertId") });
  if (!parsed.success) return;
  const session = await requireSession();

  const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);

  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    await tx
      .update(schema.dashboardAlerts)
      .set({ snoozedUntil: until, updatedAt: new Date() })
      .where(
        and(
          eq(schema.dashboardAlerts.id, parsed.data.alertId),
          eq(schema.dashboardAlerts.clinicId, session.clinicId)
        )
      );
  });

  revalidatePath("/dashboard");
}
