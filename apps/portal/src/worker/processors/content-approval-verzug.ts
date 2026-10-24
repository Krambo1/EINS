import { processContentApprovalVerzug as run } from "@/server/content-approval";

/**
 * Hourly: an approval batch past its 2-Werktage deadline with an undecided
 * post becomes a Verzug in the Garantie-Uhr (one guarantee_delays row per
 * batch, notified_at NULL, so it counts only once EINS sends the notice on
 * /admin/garantie/[clinicId]); a batch whose posts are all decided closes
 * its Verzug. Idempotent: the unique approval_batch_id makes a second run a
 * no-op. Logic in server/content-approval.ts.
 */

export interface ContentApprovalVerzugJob {
  clinicId?: string;
}

export async function processContentApprovalVerzug(job: ContentApprovalVerzugJob = {}): Promise<void> {
  const { created, closed } = await run({ clinicId: job.clinicId });
  if (created > 0 || closed > 0) {
    console.log(`[content-approval-verzug] created=${created} closed=${closed}`);
  }
}
