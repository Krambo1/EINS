"use server";

import { requirePermissionOrRedirect } from "@/auth/guards";
import { parseDashboardRange } from "@/lib/dashboard-range";
import { WerbebudgetPeriodBody, loadWerbebudgetPeriod } from "./_components/WerbebudgetPeriod";

/**
 * The period's cards of Werbebudget for one period, rendered for the kept
 * views of ParamViews (instant-views.tsx): the period switch swaps views
 * without a navigation. Checks the session and the permission itself, like
 * the page.
 */
export async function loadWerbebudgetRange(value: string) {
  const session = await requirePermissionOrRedirect("campaigns.live");
  return <WerbebudgetPeriodBody {...await loadWerbebudgetPeriod(session, parseDashboardRange(value))} />;
}
