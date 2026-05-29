"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { requireSession } from "@/auth/guards";
import {
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from "@/auth/password";
import {
  revokeAllSessionsForUser,
  revokeOtherSessionsForUser,
} from "@/auth/session";
import { writeAudit } from "@/server/audit";

/**
 * Server actions für /einstellungen/sicherheit:
 *  - Passwort ändern (alt + neu)
 *  - Auf allen Geräten abmelden
 */

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string(),
  })
  .strict();

export type SettingsActionState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | undefined;

export async function changePasswordAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const session = await requireSession();
  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Bitte beide Felder ausfüllen." };
  }
  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return { ok: false, error: policy.message ?? "Passwort zu schwach." };
  }

  const [row] = await db
    .select({ passwordHash: schema.clinicUsers.passwordHash })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, session.userId))
    .limit(1);

  const ok = await verifyPassword(
    row?.passwordHash,
    parsed.data.currentPassword
  );
  if (!ok) {
    return { ok: false, error: "Das aktuelle Passwort stimmt nicht." };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db
    .update(schema.clinicUsers)
    .set({ passwordHash: newHash, passwordSetAt: new Date() })
    .where(eq(schema.clinicUsers.id, session.userId));

  // Eine Passwort-Änderung muss alle anderen aktiven Sitzungen rauswerfen,
  // sonst kann ein bereits-eingeloggter Angreifer weiter mitspielen. Die
  // aktuelle Session bleibt drin (sonst loggt sich der User selbst aus,
  // während er sein Passwort ändert).
  await revokeOtherSessionsForUser(session.userId, session.sessionId);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entityKind: "clinic_user",
    diff: { field: "password", revoked: "other_sessions" },
  });

  revalidatePath("/einstellungen/sicherheit");
  return {
    ok: true,
    message: "Passwort aktualisiert. Andere Sitzungen wurden beendet.",
  };
}

/**
 * "Auf allen Geräten abmelden": revoke alle Sessions. Nach dem Redirect ist
 * die aktuelle Session auch tot, also landet der User direkt auf /login.
 */
export async function logoutAllDevicesAction(): Promise<void> {
  const session = await requireSession();
  await revokeAllSessionsForUser(session.userId);
  redirect("/login");
}
