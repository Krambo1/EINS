import { NextResponse, type NextRequest } from "next/server";
import { consumeAdminMagicLink } from "@/auth/admin-magic-link";
import { consumeAdminPasswordSetupToken } from "@/auth/admin-password";
import { issuePasswordSetupCookie } from "@/auth/password-setup-cookie";
import { writeAudit } from "@/server/audit";
import { adminOrigin } from "@/lib/env";
import { isCrossSiteRequest } from "@/auth/request-origin";

/**
 * Admin token consumption endpoint.
 *
 *   GET  /admin/login/callback?token=…  → 303 to /admin/login/link?token=…
 *        (read-only page with a button). NEVER consumes: mail scanners
 *        prefetch links with GET (B-1). Kept for links mailed before the change.
 *   POST /admin/login/callback (form field `token`, sent by that button)
 *        → consumes as described below.
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
  const target = new URL("/admin/login/link", adminOrigin());
  target.searchParams.set("token", token);
  const res = NextResponse.redirect(target, { status: 303 });
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(request: NextRequest) {
  // Login-CSRF guard: the button lives on our own /admin/login/link page.
  if (isCrossSiteRequest(request.headers)) {
    return NextResponse.redirect(
      new URL("/admin/login?error=invalid_or_expired", adminOrigin()),
      { status: 303 }
    );
  }
  let token: string | null = null;
  try {
    const form = await request.formData();
    const raw = form.get("token");
    token = typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    token = null;
  }
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login?error=missing", adminOrigin()), {
      status: 303,
    });
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
      new URL("/admin/set-password", adminOrigin()),
      { status: 303 }
    );
  }

  // Otherwise it's a login magic-link. consumeAdminMagicLink mints the
  // session via createAdminSession, which now THROWS when the requesting IP
  // is outside ADMIN_IP_ALLOWLIST (authn-02b/03). Catch it so a blocked IP
  // gets the same generic error instead of a 500 that confirms the link was
  // valid.
  let email: string | null;
  try {
    email = await consumeAdminMagicLink(token);
  } catch {
    return NextResponse.redirect(
      new URL("/admin/login?error=invalid_or_expired", adminOrigin()),
      { status: 303 }
    );
  }
  if (!email) {
    return NextResponse.redirect(
      new URL("/admin/login?error=invalid_or_expired", adminOrigin()),
      { status: 303 }
    );
  }

  await writeAudit({
    actorEmail: email,
    action: "login",
    entityKind: "admin_login",
  });

  return NextResponse.redirect(new URL("/admin", adminOrigin()), { status: 303 });
}
