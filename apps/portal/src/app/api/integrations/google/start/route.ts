import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { env, hasGoogle } from "@/lib/env";
import { signState, setStateCookie } from "@/server/oauth";
import { writeAudit } from "@/server/audit";

/**
 * Kick off Google Ads OAuth. Inhaber-only.
 *
 * Scope request is narrow — just the adwords API. We ask for offline access
 * so we get a refresh token for the daily sync job.
 */
export async function GET(_request: NextRequest) {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return NextResponse.redirect(new URL("/einstellungen?error=forbidden", env.APP_ORIGIN));
  }

  if (!hasGoogle() || !env.GOOGLE_REDIRECT_URI) {
    return NextResponse.redirect(
      new URL("/einstellungen?error=not_configured&platform=google", env.APP_ORIGIN)
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const state = await signState({
    clinicId: session.clinicId,
    userId: session.userId,
    platform: "google",
    nonce,
  });
  await setStateCookie(state);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "oauth_start",
    entityKind: "platform_credential",
    diff: { platform: "google" },
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_ADS_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  // "consent" forces a refresh token even on reconnects — worth the extra click.
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("include_granted_scopes", "true");

  return NextResponse.redirect(authUrl);
}
