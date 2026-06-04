import { NextResponse, type NextRequest } from "next/server";
import { hasGoogleLogin, adminOrigin } from "@/lib/env";
import { isAdminEmail, ensureAdminUser, createAdminSession } from "@/auth/admin";
import {
  exchangeCodeForGoogleEmail,
  verifyLoginState,
  readLoginStateCookie,
  clearLoginStateCookie,
  googleAdminRedirectUri,
} from "@/auth/google-login";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

/**
 * Admin "Mit Google anmelden" — step 2 (Google bounces here with ?code&state).
 *
 *   GET /admin/login/google/callback   (admin host only)
 *
 * Validates the CSRF state (cookie === query + valid signature + admin track),
 * exchanges the code for a verified email, then gates on the ADMIN_EMAILS
 * allowlist (same check as the admin magic-link flow). Allowlisted → ensure an
 * admin_users row + mint an admin session → /admin. Not allowlisted →
 * /admin/login?error=google_denied. The IP allowlist (if any) is enforced on
 * every getAdminSession() read, exactly as it is for magic-link logins.
 */
function adminLoginError(code: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/admin/login?error=${code}`, adminOrigin())
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!hasGoogleLogin()) {
    await clearLoginStateCookie();
    return adminLoginError("google_unavailable");
  }

  const ip =
    (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "")
      .split(",")[0]
      ?.trim() || "unknown";
  const rl = await rateLimit("admin-login:google:ip", ip, {
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    await clearLoginStateCookie();
    return adminLoginError("google_error");
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateQuery = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam || !code || !stateQuery) {
    await clearLoginStateCookie();
    return adminLoginError("google_error");
  }

  const stateCookie = await readLoginStateCookie();
  const statePayload =
    stateCookie && stateCookie === stateQuery
      ? await verifyLoginState(stateQuery)
      : null;
  if (!statePayload || statePayload.track !== "admin") {
    await clearLoginStateCookie();
    return adminLoginError("google_error");
  }

  let identity;
  try {
    identity = await exchangeCodeForGoogleEmail({
      code,
      redirectUri: googleAdminRedirectUri(),
    });
  } catch (err) {
    console.error("[oauth/google-login/admin] exchange failed:", err);
    await clearLoginStateCookie();
    return adminLoginError("google_error");
  }
  await clearLoginStateCookie();

  if (!identity.emailVerified) {
    return adminLoginError("google_unverified");
  }

  if (!isAdminEmail(identity.email)) {
    await writeAudit({
      actorEmail: identity.email,
      action: "login",
      entityKind: "admin_login",
      diff: { method: "google", ok: false, reason: "not_allowlisted" },
    });
    return adminLoginError("google_denied");
  }

  const { id } = await ensureAdminUser(identity.email);
  await createAdminSession(id);
  await writeAudit({
    actorEmail: identity.email,
    action: "login",
    entityKind: "admin_login",
    diff: { method: "google", ok: true },
  });

  return NextResponse.redirect(new URL("/admin", adminOrigin()));
}
