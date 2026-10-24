"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { checkPasswordPolicy, hashPassword } from "@/auth/password";
import {
  clearPasswordSetupCookie,
  readPasswordSetupCookie,
} from "@/auth/password-setup-cookie";
import { createSession, revokeAllSessionsForUser } from "@/auth/session";
import { findActiveClinicUserById } from "@/auth/user-lookup";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Server action für die Set-/Reset-Password-Page.
 *
 * Einziger Modus: Cookie-Modus. Der Callback (POST /api/auth/callback) hat
 * den Link (Einladung, Passwort einrichten oder zurücksetzen) bereits
 * konsumiert und eine kurzlebige httpOnly-Cookie ausgegeben.
 * `setPasswordFromCookieAction` validiert die Cookie, schreibt das neue
 * Passwort, widerruft alle bestehenden Sessions und mintet eine frische
 * Session.
 *
 * Der frühere Invite-Modus (Session ohne Passwort, Passwort setzen ohne
 * Nachweis) ist entfernt (B-8 / B-16): Einladungen laufen jetzt ebenfalls über
 * die Cookie, und ein Passwort lässt sich per Session nur noch unter
 * /einstellungen/sicherheit mit dem aktuellen Passwort ändern.
 */

const PasswordSchema = z.object({
  password: z.string(),
  password2: z.string(),
});

const ERR_MISMATCH = "Die beiden Eingaben stimmen nicht überein.";

export type SetPasswordState =
  | { ok: false; error: string }
  | { ok: true }
  | undefined;

export async function setPasswordFromCookieAction(
  _prev: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const parsed = PasswordSchema.safeParse({
    password: formData.get("password"),
    password2: formData.get("password2"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Bitte beide Felder ausfüllen." };
  }
  // B-4: the repeat field is checked on the server too, so a typo can never
  // set a password the owner does not know.
  if (parsed.data.password !== parsed.data.password2) {
    return { ok: false, error: ERR_MISMATCH };
  }

  const policy = checkPasswordPolicy(parsed.data.password);
  if (!policy.ok) {
    return { ok: false, error: policy.message ?? "Passwort zu schwach." };
  }

  const ip = (await getTrustedClientIp()) ?? "unknown";
  const rl = await rateLimit("set-password:ip", ip, {
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    return { ok: false, error: "Zu viele Versuche. Bitte später erneut." };
  }

  // Cookie wurde im Callback gesetzt nachdem der Magic-Link atomar konsumiert
  // wurde. Fehlt sie hier, ist der 10-min-Fenster abgelaufen ODER der User
  // hat einen Tab geöffnet ohne über den Callback zu kommen.
  const setup = await readPasswordSetupCookie("clinic");
  if (!setup) {
    return {
      ok: false,
      error:
        "Der Link ist abgelaufen. Bitte fordern Sie einen neuen Link an.",
    };
  }

  // Vor dem Write nochmal validieren dass der User existiert, nicht
  // archiviert ist und seine Praxis aktiv ist (G-05). Cookie ist signiert,
  // aber das Modell könnte sich seit Issuance verändert haben.
  const active = await findActiveClinicUserById(setup.userId);
  const [user] = active
    ? await db
        .select({
          id: schema.clinicUsers.id,
          clinicId: schema.clinicUsers.clinicId,
          role: schema.clinicUsers.role,
        })
        .from(schema.clinicUsers)
        .where(eq(schema.clinicUsers.id, active.id))
        .limit(1)
    : [];

  if (!user) {
    await clearPasswordSetupCookie("clinic");
    return {
      ok: false,
      error: "Konto nicht gefunden.",
    };
  }

  const hash = await hashPassword(parsed.data.password);
  await db
    .update(schema.clinicUsers)
    .set({ passwordHash: hash, passwordSetAt: new Date() })
    .where(eq(schema.clinicUsers.id, user.id));

  // Bestehende Sessions widerrufen: auch wenn der User vorher keine hatte,
  // muss ein bereits-eingeloggter Angreifer (per gestohlener Session) nach
  // Password-Reset rausfliegen.
  await revokeAllSessionsForUser(user.id);
  await clearPasswordSetupCookie("clinic");

  await writeAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "update",
    entityKind: "clinic_user",
    diff: {
      field: "password",
      via: setup.intent,
      revoked: "all_sessions",
    },
  });

  await createSession(user.id);

  redirect(`${defaultLandingPath(user.role as Role | null)}?password=set`);
}
