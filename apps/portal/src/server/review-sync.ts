import "server-only";
import {
  processSyncReviewsGoogle,
} from "@/worker/processors/sync-reviews-google";
import {
  processSyncReviewsJameda,
} from "@/worker/processors/sync-reviews-jameda";

export type ReviewPlatform = "google" | "jameda";

export interface PlatformSyncOutcome {
  platform: ReviewPlatform;
  ok: boolean;
  error?: string;
}

/**
 * Run both review syncs for one clinic in parallel, swallow per-platform
 * errors, and report which ones succeeded. Used by the "Jetzt aktualisieren"
 * button on /einstellungen so the inhaber gets immediate feedback instead of
 * waiting for tomorrow's 04:00 UTC cron.
 *
 * Same processor code runs from BullMQ in production — manual + scheduled
 * paths produce identical snapshots.
 */
export async function syncAllReviewsForClinic(
  clinicId: string
): Promise<PlatformSyncOutcome[]> {
  const platforms: Array<{
    platform: ReviewPlatform;
    run: () => Promise<void>;
  }> = [
    { platform: "google", run: () => processSyncReviewsGoogle({ clinicId }) },
    { platform: "jameda", run: () => processSyncReviewsJameda({ clinicId }) },
  ];

  const results = await Promise.allSettled(platforms.map((p) => p.run()));

  return platforms.map((p, i) => {
    const result = results[i]!;
    if (result.status === "fulfilled") {
      return { platform: p.platform, ok: true };
    }
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    return { platform: p.platform, ok: false, error: message };
  });
}
