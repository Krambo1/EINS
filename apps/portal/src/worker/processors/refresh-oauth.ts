import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasGoogle } from "@/lib/env";
import { decryptString, encryptString } from "@/lib/crypto";
import { GOOGLE_RECONNECT, notifyOwnersOnce } from "./connection-alerts";

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
  // Archived Praxen (contract ended) are skipped: no Google calls, no Meta
  // reconnect bells (INT-A A5 b).
  const activeClinics = db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(isNull(schema.clinics.archivedAt));

  // Google — refresh anything expiring within 30 min.
  if (hasGoogle()) {
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    const rows = await db
      .select()
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.platform, "google"),
          inArray(schema.platformCredentials.clinicId, activeClinics),
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
        // E-29: 400/401 from the token endpoint = grant revoked or expired;
        // only the Inhaber:in can fix that by reconnecting.
        if (/http 40[01]/.test(message)) {
          await notifyOwnersOnce({ clinicId: row.clinicId, ...GOOGLE_RECONNECT, dedupeDays: 7 }).catch(
            () => 0
          );
        }
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
        inArray(schema.platformCredentials.clinicId, activeClinics),
        sql`${schema.platformCredentials.expiresAt} IS NOT NULL`,
        lte(schema.platformCredentials.expiresAt, metaCutoff)
      )
    );

  // E-09: at most one bell per Inhaber:in per week (SQL dedupe), instead of
  // a new row on every 15-minute tick. Already expired tokens say so.
  for (const m of expiring) {
    const expired = m.expiresAt ? m.expiresAt.getTime() <= Date.now() : false;
    await notifyOwnersOnce({
      clinicId: m.clinicId,
      kind: "meta_token_expiring",
      title: expired ? "Meta-Verbindung abgelaufen" : "Meta-Verbindung läuft bald ab",
      body: "Bitte in den Einstellungen erneut verbinden, damit die Werbedaten weiter synchronisiert werden.",
      link: "/einstellungen#integrationen",
      dedupeDays: 7,
    });
  }
}

async function refreshGoogle(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
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
