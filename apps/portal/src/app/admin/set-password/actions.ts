"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import {
  createAdminSession,
  revokeAllAdminSessionsForAdmin,
} from "@/auth/admin";
import { writeAdminPasswordHash } from "@/auth/admin-password";
import { checkPasswordPolicy } from "@/auth/password";
import {
  clearPasswordSetupCookie,
  readPasswordSetupCookie,
} from "@/auth/password-setup-cookie";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

const Schema = z.object({
  password: z.string(),
});

function ipFromHeaders(xff: string | null, xri: string | null): string {
  return (xff ?? xri ?? "").split(",")[0]?.trim() || "unknown";
}

/**
 * State shape:
 *  - `error` setzt die inline-Fehlermeldung. `expired: true` zeigt zusätzlich
 *    einen "Zurück zur Anmeldung"-Link, weil die Setup-Sitzung weg ist.
 *  - `ok: true` mit `redirectTo` signalisiert Erfolg; die Client-Form macht
 *    dann router.push() darauf. Server-side redirect() würde den Next.js
 *    #65893-Bug triggern (Server-Action redirect unter admin.*-Subdomain-
 *    Rewrite → not-found.tsx bis Hard-Reload).
 */
export type SetAdminPasswordActionState =
  | { error: string; expired?: boolean }
  | { ok: true; redirectTo: string }
  | undefined;

const ERR_INVALID_INPUT = "Bitte ein Passwort angeben.";
const ERR_POLICY = "Bitte ein Passwort mit mindestens 10 Zeichen wählen.";
const ERR_RATE_LIMITED = "Zu viele Versuche. Bitte einen Moment warten.";
const ERR_EXPIRED =
  "Die Setup-Sitzung ist abgelaufen. Bitte fordern Sie einen neuen Link an.";

/**
 * Set the admin password via the cookie-based handover flow. The token from
 * the magic-link URL has already been burned in /admin/login/callback; we
 * read the userId from a signed httpOnly cookie (10 min TTL).
 *
 * On success we revoke ALL existing admin sessions for this admin (a password
 * reset must invalidate prior credentials, otherwise a stolen session can
 * outlive the reset) and mint a fresh session.
 *
 * Result-Handling (post-2026-05-28): Fehler UND Success werden als State
 * zurückgegeben. Die Client-Form rendert Fehler inline; bei `ok: true` macht
 * sie router.push(redirectTo). Hintergrund: Next.js #65893 — Server-Action-
 * Redirects auf /admin/* unter admin.*-Subdomain-Rewrite zeigen not-found.tsx
 * bis Hard-Reload, deshalb hier konsequent client-side navigieren.
 */
export async function setAdminPasswordAction(
  _prev: SetAdminPasswordActionState,
  formData: FormData
): Promise<SetAdminPasswordActionState> {
  const parsed = Schema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: ERR_INVALID_INPUT };
  }
  const policy = checkPasswordPolicy(parsed.data.password);
  if (!policy.ok) {
    return { error: ERR_POLICY };
  }

  const hdrs = await headers();
  const ip = ipFromHeaders(
    hdrs.get("x-forwarded-for"),
    hdrs.get("x-real-ip")
  );
  const rl = await rateLimit("admin-set-pwd:ip", ip, {
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    return { error: ERR_RATE_LIMITED };
  }

  const setup = await readPasswordSetupCookie("admin");
  if (!setup) {
    return { error: ERR_EXPIRED, expired: true };
  }

  const [adminRow] = await db
    .select({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, setup.userId))
    .limit(1);

  if (!adminRow) {
    await clearPasswordSetupCookie("admin");
    return { error: ERR_EXPIRED, expired: true };
  }

  await writeAdminPasswordHash(adminRow.id, parsed.data.password);

  await revokeAllAdminSessionsForAdmin(adminRow.id);
  await clearPasswordSetupCookie("admin");

  await writeAudit({
    actorEmail: adminRow.email,
    action: "update",
    entityKind: "admin_password",
    diff: { via: "cookie", revoked: "all_admin_sessions" },
  });

  await createAdminSession(adminRow.id);

  return { ok: true, redirectTo: "/admin?password=set" };
}
