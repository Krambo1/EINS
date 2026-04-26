import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, hasMeta } from "@/lib/env";
import { decryptString } from "@/lib/crypto";

/**
 * Daily Meta Ads sync — pulls yesterday's spend/impressions/clicks/leads per
 * clinic and upserts into `campaign_snapshots`.
 *
 * Minimal first version: one request per connected clinic, aggregated across
 * ad accounts the user granted us access to. No pagination yet — sufficient
 * for early clinics (typically one ad account).
 *
 * If Meta isn't configured globally, we short-circuit with a log.
 */

export interface SyncMetaJob {
  clinicId: string;
  /** Optional YYYY-MM-DD — defaults to yesterday. */
  date?: string;
}

export async function processSyncMeta(job: SyncMetaJob): Promise<void> {
  const { clinicId } = job;

  if (!hasMeta()) {
    console.log("[sync-meta] meta not configured — skipping");
    return;
  }

  const [cred] = await db
    .select()
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, "meta")
      )
    )
    .limit(1);
  if (!cred) {
    console.log(`[sync-meta] no credentials for clinic=${clinicId}`);
    return;
  }

  const token = decryptString(cred.accessTokenEnc);
  const date = job.date ?? yyyyMmDd(daysAgo(1));

  try {
    // 1. List ad accounts the user has access to.
    const accountsRes = await fetch(
      `https://graph.facebook.com/${env.META_API_VERSION}/me/adaccounts?fields=id,name&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    if (!accountsRes.ok) throw new Error(`meta accounts http ${accountsRes.status}`);
    const accounts = (await accountsRes.json()) as { data?: { id: string }[] };

    let spend = 0;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;

    for (const acc of accounts.data ?? []) {
      const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/${acc.id}/insights`);
      url.searchParams.set("time_range", JSON.stringify({ since: date, until: date }));
      url.searchParams.set("fields", "spend,impressions,clicks,actions");
      url.searchParams.set("access_token", token);

      const ins = await fetch(url, { cache: "no-store" });
      if (!ins.ok) continue;
      const body = (await ins.json()) as {
        data?: {
          spend?: string;
          impressions?: string;
          clicks?: string;
          actions?: { action_type: string; value: string }[];
        }[];
      };
      for (const row of body.data ?? []) {
        spend += Number(row.spend ?? 0);
        impressions += Number(row.impressions ?? 0);
        clicks += Number(row.clicks ?? 0);
        const leadAction = row.actions?.find(
          (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
        );
        if (leadAction) leads += Number(leadAction.value);
      }
    }

    const cpl = leads > 0 ? Number((spend / leads).toFixed(2)) : null;
    const ctr = impressions > 0 ? Number((clicks / impressions).toFixed(4)) : null;

    await db
      .insert(schema.campaignSnapshots)
      .values({
        clinicId,
        snapshotDate: date,
        platform: "meta",
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
    console.error(`[sync-meta] clinic=${clinicId} failed:`, message);
    await db
      .update(schema.platformCredentials)
      .set({ lastSyncError: message.slice(0, 500) })
      .where(eq(schema.platformCredentials.id, cred.id));
    throw err; // let BullMQ retry
  }
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function yyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
