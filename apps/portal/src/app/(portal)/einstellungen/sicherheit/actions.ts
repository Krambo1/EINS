"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { requireSession } from "@/auth/guards";
import {
  impersonationBlockedMessage,
  isImpersonating,
} from "@/auth/impersonation-guard";
import { AUTH_BUCKETS } from "@/auth/rate-limit-policy";
import { releaseRateLimitSlot, reserveRateLimitSlot } from "@/server/rate-limit-slot";
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
 *
 * Beide sind in einer Admin-Ansicht als Benutzer gesperrt (Entscheidung
 * 2026-10-07, B-8 / B-26 / G-10): ein Admin übernimmt nie das Konto und wirft
 * die Praxisperson nicht von ihren Geräten.
 */

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string(),
    newPassword2: z.string(),
  })
  .strict();

const ERR_TOO_MANY =
  "Zu viele falsche Eingaben des aktuellen Passworts. Bitte warten Sie eine Stunde oder setzen Sie das Passwort über „Passwort vergessen“ zurück.";

export type SettingsActionState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | undefined;

export async function changePasswordAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const session = await requireSession();
  if (isImpersonating(session)) {
    return { ok: false, error: impersonationBlockedMessage("password") };
  }
  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPassword2: formData.get("newPassword2"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Bitte alle Felder ausfüllen." };
  }
  if (parsed.data.newPassword !== parsed.data.newPassword2) {
    return { ok: false, error: "Die beiden neuen Passwörter stimmen nicht überein." };
  }
  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return { ok: false, error: policy.message ?? "Passwort zu schwach." };
  }

  // Wrong "aktuelles Passwort" attempts per user (B-16), count only failures.
  // The slot is reserved atomically BEFORE the Argon2 verify (V3 Neben 2), so
  // parallel submits never run more than 10 checks per user and window; the
  // right current password gives it back.
  const bucket = AUTH_BUCKETS.passwordChangeFailByUser;
  const reserved = await reserveRateLimitSlot(bucket.scope, session.userId, bucket);
  if (!reserved.ok) {
    return { ok: false, error: ERR_TOO_MANY };
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
    // The reserved slot stays taken: it is the failure count.
    return { ok: false, error: "Das aktuelle Passwort stimmt nicht." };
  }
  await releaseRateLimitSlot(reserved.slot);

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
  if (isImpersonating(session)) {
    // The page hides the button in this mode; this is the server-side guard.
    redirect("/einstellungen/sicherheit");
  }
  await revokeAllSessionsForUser(session.userId);
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "logout",
    entityKind: "login",
    diff: { scope: "all_devices" },
  });
  redirect("/login");
}
