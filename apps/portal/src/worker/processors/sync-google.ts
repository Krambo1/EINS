import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasGoogle } from "@/lib/env";
import { decryptString, encryptString } from "@/lib/crypto";
import { GOOGLE_ADS_API_VERSION } from "@/server/google-ads-oci";
import { berlinYesterday } from "./berlin-days";
import { GOOGLE_RECONNECT, notifyOwnersOnce } from "./connection-alerts";

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

  if (!hasGoogle()) {
    console.log("[sync-google] google not configured — skipping");
    return;
  }

  // E-04: query the Praxis's OWN Ads account. The env login id is only the
  // EINS manager account (MCC) used as login-customer-id header fallback;
  // querying it returned the MCC's numbers for every Praxis.
  const [clinic] = await db
    .select({
      customerId: schema.clinics.googleAdsCustomerId,
      loginCustomerId: schema.clinics.googleAdsLoginCustomerId,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  const customerId = digitsOnly(clinic?.customerId);
  const loginCustomerId =
    digitsOnly(clinic?.loginCustomerId) ?? digitsOnly(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

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

  if (!customerId) {
    // Visible in the admin "Sync-Fehler" list instead of a log line only.
    console.log(`[sync-google] clinic=${clinicId} has no google_ads_customer_id — skipping`);
    await db
      .update(schema.platformCredentials)
      .set({ lastSyncError: "Google-Ads-Kundennummer der Praxis fehlt (clinics.google_ads_customer_id)." })
      .where(eq(schema.platformCredentials.id, cred.id));
    return;
  }

  const refreshToken = decryptString(cred.refreshTokenEnc);
  // Berlin "gestern" (the Ads account reports in its own time zone, which
  // for DACH accounts is Europe/Berlin).
  const date = job.date ?? berlinYesterday();

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
    const headers: Record<string, string> = {
      Authorization: `Bearer ${access.access_token}`,
      "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "Content-Type": "application/json",
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
    const gaqlRes = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!gaqlRes.ok) {
      throw new Error(
        gaqlRes.status === 404
          ? `google ads http 404 (API ${GOOGLE_ADS_API_VERSION} sunset? set GOOGLE_ADS_API_VERSION)`
          : `google ads http ${gaqlRes.status}`
      );
    }

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
    // E-29: after 3 days without a successful sync (or a revoked grant), tell
    // the Inhaber:in once a week instead of failing silently.
    const lastOk = cred.lastSyncedAt?.getTime() ?? cred.createdAt?.getTime() ?? 0;
    if (/google refresh http 40[01]/.test(message) || Date.now() - lastOk > 3 * 86_400_000) {
      await notifyOwnersOnce({ clinicId, ...GOOGLE_RECONNECT, dedupeDays: 7 }).catch(() => 0);
    }
    throw err;
  }
}

function digitsOnly(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

async function refreshAccessToken(refreshToken: string): Promise<{
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
