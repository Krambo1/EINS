import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  consumeMagicLink,
  consumeMagicLinkForPasswordSetup,
} from "@/auth/magic-link";
import { issuePasswordSetupCookie } from "@/auth/password-setup-cookie";
import { writeAudit } from "@/server/audit";
import { db, schema } from "@/db/client";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Magic-link landing endpoint. Reached when the user clicks the link in their
 * inbox.
 *
 *   GET /api/auth/callback?token=<url-safe-token>
 *
 * Routing:
 *   - intent=login  → consume token + mint session → /dashboard
 *   - intent=invite → consume token + mint session → /set-password (so user
 *                     can pick a password before landing in the app)
 *   - intent=set_password / reset_password → consume token IMMEDIATELY (so the
 *     URL doesn't keep the cleartext token through the form render), stash
 *     userId in a short-lived httpOnly cookie via `issuePasswordSetupCookie`,
 *     and redirect to /set-password — clean, NO query string. The form action
 *     reads the cookie, validates, writes the new password.
 *
 *     Trade-off: if the user clicks the link but never submits the form, the
 *     magic-link is burned (10-min cookie TTL vs 15-min URL-token TTL). Fine:
 *     a fresh "Passwort vergessen" click produces a new link instantly.
 *
 * On failure we redirect to /login with an error query.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=missing_token", req.nextUrl.origin)
    );
  }

  // Try the set-/reset-password flow first — single atomic consume that also
  // validates intent. If the token isn't for password setup, this returns
  // "invalid" (because the helper rejects non-password intents) and we fall
  // through to the login/invite consumer below.
  const pwd = await consumeMagicLinkForPasswordSetup(token);
  if (pwd.ok) {
    await issuePasswordSetupCookie("clinic", pwd.userId, pwd.intent);
    await writeAudit({
      clinicId: pwd.clinicId,
      actorId: pwd.userId,
      action: "magic_link_consume",
      entityKind: "login",
      diff: { intent: pwd.intent, stage: "callback" },
    });
    return NextResponse.redirect(new URL("/set-password", req.nextUrl.origin));
  }

  // login / invite — old flow: consume + session. consumeMagicLink rejects
  // any non-login/invite intent defensively, so the only way we get here with
  // a password-setup token is if it was already consumed above; either way
  // the result is "invalid" / "consumed" → /login error.
  const result = await consumeMagicLink(token);
  if (!result.ok) {
    // Map both possible failure paths (pwd.reason for set/reset, result.reason
    // for login/invite) to a single user-facing error. We prefer the login
    // consumer's reason because it ran second and is more informative when
    // the token was never a password token in the first place.
    return NextResponse.redirect(
      new URL(`/login?error=${result.reason}`, req.nextUrl.origin)
    );
  }

  await writeAudit({
    clinicId: result.clinicId,
    actorId: result.userId,
    action: "login",
    entityKind: "login",
    diff: { method: "magic_link", intent: result.intent },
  });

  // For 'invite' we drop the user into the set-password screen too, but they
  // already have a session — so /set-password is auth-gated and reads the
  // session's userId, not a token.
  if (result.intent === "invite") {
    return NextResponse.redirect(
      new URL("/set-password?mode=invite", req.nextUrl.origin)
    );
  }

  // Role-aware landing: frontdesk (MFA/Sekretariat) → /anfragen, others →
  // /dashboard. Cheap extra read; this path only fires on magic-link login.
  const [{ role } = { role: null }] = await db
    .select({ role: schema.clinicUsers.role })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, result.userId))
    .limit(1);

  return NextResponse.redirect(
    new URL(defaultLandingPath(role as Role | null), req.nextUrl.origin)
  );
}
