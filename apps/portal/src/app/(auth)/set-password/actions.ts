"use server";

import { redirect } from "next/navigation";
import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { checkPasswordPolicy, hashPassword } from "@/auth/password";
import {
  clearPasswordSetupCookie,
  readPasswordSetupCookie,
} from "@/auth/password-setup-cookie";
import {
  createSession,
  getSession,
  revokeAllSessionsForUser,
} from "@/auth/session";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Server actions für die Set-/Reset-Password-Page.
 *
 * Zwei Modi:
 *   1. Cookie-Modus: Der Callback (/api/auth/callback) hat den Magic-Link
 *      bereits konsumiert und eine kurzlebige httpOnly-Cookie ausgegeben.
 *      `setPasswordFromCookieAction` validiert die Cookie, schreibt das neue
 *      Passwort, widerruft alle bestehenden Sessions + Trust-Devices und
 *      mintet eine frische Session.
 *   2. Invite-Modus: User wurde gerade via Magic-Link "invite" eingeloggt
 *      (Session existiert schon, keine Cookie nötig). Direktes Update auf
 *      den geloggten User.
 */

const PasswordSchema = z.object({
  password: z.string(),
});

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
  });
  if (!parsed.success) {
    return { ok: false, error: "Ungültige Anfrage." };
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

  // Vor dem Write nochmal validieren dass der User existiert + nicht
  // archiviert ist. Cookie ist signiert aber das Modell könnte sich seit
  // Issuance verändert haben.
  const [user] = await db
    .select({
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      archivedAt: schema.clinicUsers.archivedAt,
      role: schema.clinicUsers.role,
    })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.id, setup.userId),
        isNull(schema.clinicUsers.archivedAt)
      )
    )
    .limit(1);

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

export async function setPasswordWithSessionAction(
  _prev: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = PasswordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  const policy = checkPasswordPolicy(parsed.data.password);
  if (!policy.ok) {
    return { ok: false, error: policy.message ?? "Passwort zu schwach." };
  }

  const hash = await hashPassword(parsed.data.password);
  await db
    .update(schema.clinicUsers)
    .set({ passwordHash: hash, passwordSetAt: new Date() })
    .where(eq(schema.clinicUsers.id, session.userId));

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "update",
    entityKind: "clinic_user",
    diff: { field: "password", via: "invite_session" },
  });

  redirect(`${defaultLandingPath(session.role)}?password=set`);
}
