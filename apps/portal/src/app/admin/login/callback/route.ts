import { NextResponse, type NextRequest } from "next/server";
import { consumeAdminMagicLink } from "@/auth/admin-magic-link";
import { writeAudit } from "@/server/audit";
import { env } from "@/lib/env";

/**
 * Admin magic-link callback. Exchanges the token cookie for a session cookie.
 * On failure redirects to /admin/login so a reused link behaves identically
 * to an invalid one.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login?error=missing", env.APP_ORIGIN));
  }

  const email = await consumeAdminMagicLink(token);
  if (!email) {
    return NextResponse.redirect(
      new URL("/admin/login?error=invalid_or_expired", env.APP_ORIGIN)
    );
  }

  await writeAudit({
    actorEmail: email,
    action: "login",
    entityKind: "admin_login",
  });

  return NextResponse.redirect(new URL("/admin", env.APP_ORIGIN));
}
