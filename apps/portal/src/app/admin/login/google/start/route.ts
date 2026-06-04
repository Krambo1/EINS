import { NextResponse } from "next/server";
import { hasGoogleLogin, adminOrigin } from "@/lib/env";
import {
  signLoginState,
  setLoginStateCookie,
  googleAdminRedirectUri,
  buildGoogleAuthorizeUrl,
} from "@/auth/google-login";

/**
 * Admin "Mit Google anmelden" — step 1.
 *
 *   GET /admin/login/google/start   (admin host only — host-gated by middleware)
 *
 * Signs an admin-track CSRF state, stores it in an httpOnly cookie, and
 * redirects to Google's consent screen. The matching callback lives at
 * /admin/login/google/callback. The redirect URI runs on the admin host, so
 * it must be registered separately in the GCP OAuth client.
 */
export async function GET(): Promise<NextResponse> {
  if (!hasGoogleLogin()) {
    return NextResponse.redirect(
      new URL("/admin/login?error=google_unavailable", adminOrigin())
    );
  }

  const state = await signLoginState("admin");
  await setLoginStateCookie(state);

  const authorizeUrl = buildGoogleAuthorizeUrl({
    redirectUri: googleAdminRedirectUri(),
    state,
  });
  return NextResponse.redirect(authorizeUrl);
}
