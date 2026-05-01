import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasGoogle } from "@/lib/env";
import { decryptString, encryptString } from "@/lib/crypto";

/**
 * Refresh OAuth tokens that expire in the next hour.
 *
 * Meta: long-lived tokens last ~60 days. We can't refresh without user
 * interaction — if `expires_at < now() + 7 days`, we notify the Inhaber.
 * Google: we hold a refresh_token, so we can silently swap access tokens.
 *
 * Cron calls this every 15 min.
 */
export async function processRefreshOauth(): Promise<void> {
  // Google — refresh anything expiring within 30 min.
  if (hasGoogle()) {
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    const rows = await db
      .select()
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.platform, "google"),
          isNotNull(schema.platformCredentials.refreshTokenEnc),
          sql`${schema.platformCredentials.expiresAt} IS NOT NULL`,
          lte(schema.platformCredentials.expiresAt, soon)
        )
      );

    for (const row of rows) {
      if (!row.refreshTokenEnc) continue;
      try {
        const refreshed = await refreshGoogle(decryptString(row.refreshTokenEnc));
        await db
          .update(schema.platformCredentials)
          .set({
            accessTokenEnc: encryptString(refreshed.access_token),
            expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
            lastSyncError: null,
          })
          .where(eq(schema.platformCredentials.id, row.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[refresh-oauth] google clinic=${row.clinicId} failed:`, message);
        await db
          .update(schema.platformCredentials)
          .set({ lastSyncError: message.slice(0, 500) })
          .where(eq(schema.platformCredentials.id, row.id));
      }
    }
  }

  // Meta — notify if <7 days remaining (there's no refresh).
  const metaCutoff = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const expiring = await db
    .select({
      id: schema.platformCredentials.id,
      clinicId: schema.platformCredentials.clinicId,
      expiresAt: schema.platformCredentials.expiresAt,
    })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.platform, "meta"),
        sql`${schema.platformCredentials.expiresAt} IS NOT NULL`,
        lte(schema.platformCredentials.expiresAt, metaCutoff)
      )
    );

  for (const m of expiring) {
    const users = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, m.clinicId),
          eq(schema.clinicUsers.role, "inhaber")
        )
      );
    if (users.length === 0) continue;
    await db.insert(schema.notifications).values(
      users.map((u) => ({
        userId: u.id,
        clinicId: m.clinicId,
        kind: "meta_token_expiring",
        title: "Meta-Verbindung läuft bald ab",
        body: "Bitte in den Einstellungen erneut verbinden, damit die Werbedaten weiter synchronisiert werden.",
        link: "/einstellungen#integrationen",
      }))
    );
  }
}

async function refreshGoogle(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google refresh http ${res.status}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}
