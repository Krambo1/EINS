import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { env, hasGoogle } from "@/lib/env";
import { encryptString } from "@/lib/crypto";
import { verifyState, readStateCookie, clearStateCookie } from "@/server/oauth";
import { writeAudit } from "@/server/audit";

/**
 * Google Ads OAuth callback. Stores both access + refresh tokens encrypted
 * so the daily-sync worker can refresh without user interaction.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateQuery = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_denied", env.APP_ORIGIN));
  }

  if (!code || !stateQuery) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_invalid", env.APP_ORIGIN));
  }

  const stateCookie = await readStateCookie();
  if (!stateCookie || stateCookie !== stateQuery) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_state", env.APP_ORIGIN));
  }
  const payload = await verifyState(stateQuery);
  if (!payload || payload.platform !== "google") {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_state", env.APP_ORIGIN));
  }
  if (payload.clinicId !== session.clinicId || payload.userId !== session.userId) {
    await clearStateCookie();
    return NextResponse.redirect(new URL("/einstellungen?error=oauth_state", env.APP_ORIGIN));
  }

  if (!hasGoogle() || !env.GOOGLE_REDIRECT_URI) {
    await clearStateCookie();
    return NextResponse.redirect(
      new URL("/einstellungen?error=not_configured&platform=google", env.APP_ORIGIN)
    );
  }

  try {
    const token = await exchangeCode(code);
    const accessTokenEnc = encryptString(token.access_token);
    const refreshTokenEnc = token.refresh_token ? encryptString(token.refresh_token) : null;
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;

    const existing = await db
      .select({ id: schema.platformCredentials.id })
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.clinicId, session.clinicId),
          eq(schema.platformCredentials.platform, "google")
        )
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.platformCredentials)
        .set({
          accessTokenEnc,
          // Only overwrite refresh if provider sent one — sometimes it doesn't.
          ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
          expiresAt,
          lastSyncError: null,
        })
        .where(eq(schema.platformCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.platformCredentials).values({
        clinicId: session.clinicId,
        platform: "google",
        accessTokenEnc,
        refreshTokenEnc,
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
      diff: { platform: "google" },
    });

    return NextResponse.redirect(
      new URL("/einstellungen?connected=google#integrationen", env.APP_ORIGIN)
    );
  } catch (err) {
    console.error("[oauth/google] exchange failed:", err);
    await clearStateCookie();
    return NextResponse.redirect(
      new URL("/einstellungen?error=oauth_exchange#integrationen", env.APP_ORIGIN)
    );
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET!,
      redirect_uri: env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`google oauth code exchange failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}
