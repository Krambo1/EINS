import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasGoogle } from "@/lib/env";
import { decryptString, encryptString } from "@/lib/crypto";

/**
 * Daily Google Ads sync. Minimal shape matching `sync-meta.ts`.
 *
 * The Google Ads API requires a login-customer-id header, a developer token,
 * and a short-lived OAuth access token derived from the stored refresh token.
 * We refresh on every run (tokens expire in ~1 hour) and persist the new
 * access token so parallel jobs don't re-request.
 *
 * If the clinic hasn't connected Google yet, this is a no-op.
 */

export interface SyncGoogleJob {
  clinicId: string;
  date?: string;
}

export async function processSyncGoogle(job: SyncGoogleJob): Promise<void> {
  const { clinicId } = job;

  if (!hasGoogle() || !env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    console.log("[sync-google] google not configured — skipping");
    return;
  }

  const [cred] = await db
    .select()
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, "google")
      )
    )
    .limit(1);
  if (!cred?.refreshTokenEnc) {
    console.log(`[sync-google] no refresh token for clinic=${clinicId}`);
    return;
  }

  const refreshToken = decryptString(cred.refreshTokenEnc);
  const date = job.date ?? yyyyMmDd(daysAgo(1));

  try {
    const access = await refreshAccessToken(refreshToken);
    // Persist new access token + expiry so other jobs in this window skip refresh.
    await db
      .update(schema.platformCredentials)
      .set({
        accessTokenEnc: encryptString(access.access_token),
        expiresAt: new Date(Date.now() + access.expires_in * 1000),
      })
      .where(eq(schema.platformCredentials.id, cred.id));

    // GAQL against the customer we're logged into.
    const query = `
      SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
      FROM customer
      WHERE segments.date = '${date}'
    `;
    const gaqlRes = await fetch(
      `https://googleads.googleapis.com/v18/customers/${env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access.access_token}`,
          "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN!,
          "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );
    if (!gaqlRes.ok) throw new Error(`google ads http ${gaqlRes.status}`);

    // searchStream returns an array of chunks.
    const chunks = (await gaqlRes.json()) as {
      results?: {
        metrics?: {
          costMicros?: string;
          impressions?: string;
          clicks?: string;
          conversions?: number;
        };
      }[];
    }[];

    let costMicros = 0;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;

    for (const chunk of chunks) {
      for (const row of chunk.results ?? []) {
        costMicros += Number(row.metrics?.costMicros ?? 0);
        impressions += Number(row.metrics?.impressions ?? 0);
        clicks += Number(row.metrics?.clicks ?? 0);
        leads += Math.round(Number(row.metrics?.conversions ?? 0));
      }
    }

    const spend = costMicros / 1_000_000;
    const cpl = leads > 0 ? Number((spend / leads).toFixed(2)) : null;
    const ctr = impressions > 0 ? Number((clicks / impressions).toFixed(4)) : null;

    await db
      .insert(schema.campaignSnapshots)
      .values({
        clinicId,
        snapshotDate: date,
        platform: "google",
        spendEur: spend.toFixed(2),
        impressions,
        clicks,
        leads,
        cplEur: cpl?.toString() ?? null,
        ctr: ctr?.toString() ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.campaignSnapshots.clinicId,
          schema.campaignSnapshots.snapshotDate,
          schema.campaignSnapshots.platform,
        ],
        set: {
          spendEur: spend.toFixed(2),
          impressions,
          clicks,
          leads,
          cplEur: cpl?.toString() ?? null,
          ctr: ctr?.toString() ?? null,
        },
      });

    await db
      .update(schema.platformCredentials)
      .set({ lastSyncedAt: new Date(), lastSyncError: null })
      .where(eq(schema.platformCredentials.id, cred.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync-google] clinic=${clinicId} failed:`, message);
    await db
      .update(schema.platformCredentials)
      .set({ lastSyncError: message.slice(0, 500) })
      .where(eq(schema.platformCredentials.id, cred.id));
    throw err;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{
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

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function yyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
