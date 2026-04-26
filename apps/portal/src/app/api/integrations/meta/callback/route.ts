import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { env, hasMeta } from "@/lib/env";
import { encryptString } from "@/lib/crypto";
import { verifyState, readStateCookie, clearStateCookie } from "@/server/oauth";
import { writeAudit } from "@/server/audit";

/**
 * Meta OAuth callback. Exchanges `code` for a long-lived access token and
 * persists it encrypted under `platform_credentials(clinic_id, platform='meta')`.
 *
 * Security:
 *   - state must be present in BOTH query and cookie, and match
 *   - callback session user must match the state payload (no session swap)
 *
 * Failure modes all redirect back to /einstellungen with an error=... param;
 * we never leak provider-side error messages verbatim.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateQuery = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    await clearStateCookie();
    return NextResponse.redirect(new URL(`/einstellungen?error=oauth_denied`, env.APP_ORIGIN));
  }

  if (!code || !stateQuery) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_invalid", env.APP_ORIGIN));
  }

  // Verify state binding.
  const stateCookie = await readStateCookie();
  if (!stateCookie || stateCookie !== stateQuery) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_state", env.APP_ORIGIN));
  }
  const payload = await verifyState(stateQuery);
  if (!payload || payload.platform !== "meta") {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_state", env.APP_ORIGIN));
  }
  if (payload.clinicId !== session.clinicId || payload.userId !== session.userId) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_state", env.APP_ORIGIN));
  }

  if (!hasMeta() || !env.META_REDIRECT_URI) {
    await clearStateCookie();
    return NextResponse.redirect(
      new URL("/einstellungen?error=not_configured&platform=meta", env.APP_ORIGIN)
    );
  }

  // Exchange code → short-lived token, then upgrade to long-lived.
  try {
    const short = await exchangeCode(code);
    const long = await upgradeToLongLived(short.access_token);

    const accessTokenEnc = encryptString(long.access_token);
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000)
      : null;

    // Upsert on (clinic_id, platform).
    const existing = await db
      .select({ id: schema.platformCredentials.id })
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.clinicId, session.clinicId),
          eq(schema.platformCredentials.platform, "meta")
        )
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.platformCredentials)
        .set({
          accessTokenEnc,
          expiresAt,
          lastSyncError: null,
        })
        .where(eq(schema.platformCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.platformCredentials).values({
        clinicId: session.clinicId,
        platform: "meta",
        accessTokenEnc,
        expiresAt,
      });
    }

    await clearStateCookie();
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "oauth_connect",
      entityKind: "platform_credential",
      diff: { platform: "meta" },
    });

    return NextResponse.redirect(
      new URL("/einstellungen?connected=meta#integrationen", env.APP_ORIGIN)
    );
  } catch (err) {
    console.error("[oauth/meta] exchange failed:", err);
    await clearStateCookie();
    return NextResponse.redirect(
      new URL("/einstellungen?error=oauth_exchange#integrationen", env.APP_ORIGIN)
    );
  }
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", env.META_APP_ID!);
  url.searchParams.set("client_secret", env.META_APP_SECRET!);
  url.searchParams.set("redirect_uri", env.META_REDIRECT_URI!);
  url.searchParams.set("code", code);

  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`meta oauth code exchange failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

async function upgradeToLongLived(shortToken: string): Promise<TokenResponse> {
  const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", env.META_APP_ID!);
  url.searchParams.set("client_secret", env.META_APP_SECRET!);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`meta long-lived exchange failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}
