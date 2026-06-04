import { NextResponse, type NextRequest } from "next/server";
import { hasGoogleLogin } from "@/lib/env";
import {
  signLoginState,
  setLoginStateCookie,
  googleClinicRedirectUri,
  buildGoogleAuthorizeUrl,
} from "@/auth/google-login";

/**
 * Clinic "Mit Google anmelden" — step 1.
 *
 *   GET /api/auth/google/start
 *
 * Signs a CSRF state, stores it in an httpOnly cookie, and redirects the
 * browser to Google's consent screen. The matching callback lives at
 * /api/auth/google/callback. If Google login isn't configured we bounce back
 * to /login (the button shouldn't render in that case, but guard anyway).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!hasGoogleLogin()) {
    return NextResponse.redirect(
      new URL("/login?error=google_unavailable", req.nextUrl.origin)
    );
  }

  const state = await signLoginState("clinic");
  await setLoginStateCookie(state);

  const authorizeUrl = buildGoogleAuthorizeUrl({
    redirectUri: googleClinicRedirectUri(),
    state,
  });
  return NextResponse.redirect(authorizeUrl);
}
