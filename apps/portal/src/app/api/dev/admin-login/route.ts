import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminSession, ensureAdminUser } from "@/auth/admin";
import { writeAudit } from "@/server/audit";

/**
 * Dev-only one-click admin login, used by the "EINS Portal (lokal)" desktop
 * shortcut (scripts/open-portal-local.ps1). Opens an admin session for the
 * first ADMIN_EMAILS entry and lands on the admin dashboard, skipping /login.
 *
 * Every gate must pass, otherwise a plain 404:
 *  - NODE_ENV is not production (the route is dead code in any deploy),
 *  - the Host is loopback or *.localhost,
 *  - DEV_AUTO_LOGIN_TOKEN is set in the server env. Only the launcher sets it,
 *    with a fresh random value per server start, so a plain `pnpm dev` has no
 *    auto-login at all,
 *  - `?token=` matches it, so another local page or site can't trigger a login
 *    with a cross-site navigation.
 *
 * Production or a non-local host gets a 404; a missing or wrong token on a
 * local dev server redirects to the normal /login.
 */
export const dynamic = "force-dynamic";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/i;

function notFound() {
  return new NextResponse("Not found.", { status: 404 });
}

function tokenMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (env.NODE_ENV === "production" || process.env.NODE_ENV === "production") return notFound();

  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return notFound();

  // A server not started by the launcher (no token) or a stale token: fall back
  // to the normal login page instead of a dead 404 window.
  const expected = process.env.DEV_AUTO_LOGIN_TOKEN ?? "";
  const url = new URL(request.url);
  if (expected.length < 32 || !tokenMatches(url.searchParams.get("token") ?? "", expected)) {
    return NextResponse.redirect(new URL("/login", `http://${host}`));
  }

  const email = env.ADMIN_EMAILS[0];
  if (!email) return new NextResponse("ADMIN_EMAILS is empty.", { status: 500 });

  const admin = await ensureAdminUser(email);
  await createAdminSession(admin.id, { rememberMe: true });
  await writeAudit({
    actorEmail: email,
    action: "login",
    entityKind: "admin_login",
    diff: { method: "dev_auto_login", ok: true },
  });

  // Relative to the admin host the request came in on (admin.localhost:<port>).
  return NextResponse.redirect(new URL("/", `http://${host}`));
}
