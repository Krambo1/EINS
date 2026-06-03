import { NextResponse, type NextRequest } from "next/server";
import { consumeAdminMagicLink } from "@/auth/admin-magic-link";
import { consumeAdminPasswordSetupToken } from "@/auth/admin-password";
import { issuePasswordSetupCookie } from "@/auth/password-setup-cookie";
import { writeAudit } from "@/server/audit";
import { adminOrigin } from "@/lib/env";

/**
 * Admin landing endpoint for ANY admin token in a magic-link URL.
 *
 *   GET /admin/login/callback?token=<url-safe-token>
 *
 * Two flavors share this endpoint, distinguished by the token's `purpose`
 * column in the `admin_tokens` table:
 *
 *   - purpose 'login' → standard admin login. Exchanges the token for an
 *     admin session and lands on /admin.
 *   - purpose 'password_reset' → password-setup. Burns the token (atomic
 *     DELETE ... RETURNING), stashes the admin id in a short-lived httpOnly
 *     cookie via `issuePasswordSetupCookie`, and lands on /admin/set-password
 *     — clean URL, NO query string. The set-password form reads the cookie
 *     and writes the new password.
 *
 * Order matters: we try the password-setup path first. A given token only
 * matches one purpose (32-byte random preimage), so the "wrong" consume is
 * a no-op for the other purpose.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login?error=missing", adminOrigin()));
  }

  // Password-setup first. Returns null if the token wasn't an adm:pwd: token.
  const setup = await consumeAdminPasswordSetupToken(token);
  if (setup) {
    // Intent "reset_password" is the only flavour issued for admins today —
    // there's no distinct "set_password" path because every admin's initial
    // password is established via the same forgot-password flow.
    await issuePasswordSetupCookie("admin", setup.id, "reset_password");
    await writeAudit({
      actorEmail: setup.email,
      action: "magic_link_consume",
      entityKind: "admin_login",
      diff: { intent: "reset_password", stage: "callback" },
    });
    return NextResponse.redirect(
      new URL("/admin/set-password", adminOrigin())
    );
  }

  // Otherwise it's a login magic-link.
  const email = await consumeAdminMagicLink(token);
  if (!email) {
    return NextResponse.redirect(
      new URL("/admin/login?error=invalid_or_expired", adminOrigin())
    );
  }

  await writeAudit({
    actorEmail: email,
    action: "login",
    entityKind: "admin_login",
  });

  return NextResponse.redirect(new URL("/admin", adminOrigin()));
}
