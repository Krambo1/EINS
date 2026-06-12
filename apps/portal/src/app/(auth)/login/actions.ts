"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { issueMagicLink } from "@/auth/magic-link";
import { verifyPassword } from "@/auth/password";
import { createSession } from "@/auth/session";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Login-Action für Clinic-User.
 *
 * Primary path: Email + Passwort. Bei Match wird eine Session erzeugt; der
 * User landet direkt im Dashboard.
 *
 * Enumeration-Resistenz: alle Fehlerpfade (unknown email / known email-without-
 * password / known email-wrong-password) liefern dieselbe generische Meldung.
 * Bestands-User ohne Passwort gehen explizit über "Passwort vergessen", weil
 * dieser Pfad enumeration-sicher ist (silent no-op bei unbekannten Mails,
 * immer 200 + "wir haben Ihnen einen Link geschickt").
 *
 * Magic-Link-Pfad: bleibt als manueller Fallback unter dem Formular sowie als
 * Passwort-vergessen-Pfad bestehen, siehe requestMagicLinkAction unten.
 */

const PasswordLoginSchema = z.object({
  email: z.string().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
  password: z.string().min(1, "Bitte geben Sie Ihr Passwort ein."),
});

const MagicLinkSchema = z.object({
  email: z.string().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
});

export type LoginActionState =
  | { ok: false; error: string }
  | { ok: true }
  | undefined;

async function checkLoginRateLimits(email: string): Promise<LoginActionState> {
  const ip = (await getTrustedClientIp()) ?? "unknown";
  const perEmail = await rateLimit("login:email", email, {
    limit: 10,
    windowSeconds: 60 * 60,
  });
  const perIp = await rateLimit("login:ip", ip, {
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!perEmail.ok || !perIp.ok) {
    return {
      ok: false,
      error:
        "Zu viele Anmelde-Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
    };
  }
  return undefined;
}

/**
 * Server action: Email + Passwort.
 *
 * Verhält sich enumeration-resistent: alle Fehler-Pfade (unknown email /
 * known email-no-password / known email-wrong-password) liefern dieselbe
 * generische Meldung "E-Mail oder Passwort stimmt nicht". verifyPassword wird
 * IMMER aufgerufen (auch bei unbekanntem User) damit die Wall-Clock-Zeit
 * gleich bleibt — siehe `verifyPassword` in @/auth/password.
 *
 * Bestands-User ohne Passwort kommen über den "Passwort vergessen"-Link rein
 * (requestPasswordResetAction), der enumeration-sicher ist.
 */
export async function passwordLoginAction(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = PasswordLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
    };
  }
  const email = parsed.data.email.toLowerCase();
  const rememberMe = formData.get("remember") === "on";

  const rl = await checkLoginRateLimits(email);
  if (rl) return rl;

  const [user] = await db
    .select({
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      passwordHash: schema.clinicUsers.passwordHash,
      role: schema.clinicUsers.role,
    })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.email, email),
        isNull(schema.clinicUsers.archivedAt)
      )
    )
    .limit(1);

  // verifyPassword läuft auch wenn user oder passwordHash fehlen, sonst leakt
  // die Wall-Clock-Zeit die Account-/Passwort-Existenz. Siehe DUMMY_HASH in
  // @/auth/password.
  const ok = await verifyPassword(user?.passwordHash, parsed.data.password);
  if (!user || !ok) {
    await writeAudit({
      actorEmail: email,
      action: "login",
      entityKind: "login",
      diff: {
        method: "password",
        ok: false,
        reason: !user
          ? "unknown_email"
          : !user.passwordHash
          ? "no_password_set"
          : "wrong_password",
      },
    });
    return { ok: false, error: "E-Mail oder Passwort stimmt nicht." };
  }

  await createSession(user.id, { rememberMe });
  await writeAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    actorEmail: email,
    action: "login",
    entityKind: "login",
    diff: { method: "password", ok: true, rememberMe },
  });

  redirect(defaultLandingPath(user.role as Role | null));
}

/**
 * Magic-Link-Pfad: bleibt unter dem Formular als Alternative bestehen
 * ("Lieber per E-Mail-Link anmelden"). Dieselbe Action wird auch von
 * /login/forgot-password genutzt.
 *
 * Antwortet IMMER mit dem "Wir haben Ihnen einen Link geschickt"-Redirect,
 * egal ob der User existiert oder nicht -- verhindert Enumeration.
 */
export async function requestMagicLinkAction(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = MagicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
    };
  }
  const email = parsed.data.email.toLowerCase();

  const rl = await checkLoginRateLimits(email);
  if (rl) return rl;

  await issueMagicLink({ email, intent: "login" });
  await writeAudit({
    actorEmail: email,
    action: "magic_link_request",
    entityKind: "login",
    diff: { email },
  });

  redirect("/login?sent=1");
}

/**
 * Passwort-Vergessen-Pfad: identisch zum Magic-Link-Fallback aber mit
 * intent=reset_password, sodass der Callback auf /reset-password landet.
 *
 * Returnt `{ ok: true }` statt zu redirecten, damit die Confirmation inline
 * auf /forgot-password gerendert wird — der User bleibt im Kontext der Aktion.
 */
export async function requestPasswordResetAction(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = MagicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
    };
  }
  const email = parsed.data.email.toLowerCase();

  const rl = await checkLoginRateLimits(email);
  if (rl) return rl;

  await issueMagicLink({ email, intent: "reset_password" });
  await writeAudit({
    actorEmail: email,
    action: "magic_link_request",
    entityKind: "login",
    diff: { reason: "password_reset" },
  });

  return { ok: true };
}
