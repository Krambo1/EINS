import { requirePermissionOrRedirect } from "@/auth/guards";
import { ParamViews, ParamViewsSlot } from "@/app/_components/instant-views";
import { PageHeader } from "../_components/PageHeader";
import { WerbebudgetRangeSwitch } from "./_components/WerbebudgetRangeSwitch";
import { WerbekontenAction } from "./_components/WerbebudgetParts";
import { WerbebudgetPeriodBody, loadWerbebudgetPeriod } from "./_components/WerbebudgetPeriod";
import { parseDashboardRange } from "@/lib/dashboard-range";
import { can } from "@/lib/roles";
import { WB_DEFAULT_RANGE, WB_PARAM, WB_RANGE_VALUES } from "./_lib/werbebudget";
import { loadWerbebudgetRange } from "./range-actions";

export const metadata = { title: "Werbebudget" };

type Search = { zeitraum?: string | string[] };

/**
 * Werbebudget, rebuilt on the Übersicht's parts (Karam, 2026-10-29: "simplify
 * and cut, then copy"): the period switch with the page's one action, then
 * Kennzahlen, Plattformen and Kampagnen (WerbebudgetPeriod.tsx). The switch
 * is the Übersicht's, with its four periods, and instant: the server renders
 * the period in the address, ParamViews keeps one view per period and loads
 * the others while the browser is idle (DESIGN.md section 10, "A view switch
 * is instant"). Cut: the page subtitle,
 * the dashed notice, the per-platform mini charts, Impressionen and Klicks,
 * the sync history, the Konto-ID and the "Hinweise zur Messung" card (its two
 * sentences are the explainers on Werbebudget and Anfragen).
 */
export default async function WerbebudgetPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePermissionOrRedirect("campaigns.live");
  const range = parseDashboardRange((await searchParams).zeitraum);
  const period = await loadWerbebudgetPeriod(session, range);
  const canConnect = can(session.role, "settings.integrations");

  return (
    <ParamViews param={WB_PARAM} values={WB_RANGE_VALUES} defaultValue={WB_DEFAULT_RANGE} load={loadWerbebudgetRange}>
      {/* From lg the nav says where we are: the period switch is the first
          row, on the line of the logo, with the page's action at its right
          end. Below lg the four periods and the action do not fit on one
          line, so the title row stays, with the action beside it (Inhalte
          shows its title the same way). */}
      <PageHeader
        title="Werbebudget"
        className="mb-4 md:mb-6 lg:sr-only"
        actions={<WerbekontenAction connected={period.connected} canConnect={canConnect} className="lg:hidden" />}
      />
      <div className="space-y-4 md:space-y-6">
        {/* A block below lg, so the sticky switch spans the phone's width. */}
        <div className="lg:flex lg:min-h-[var(--shell-row)] lg:items-center lg:justify-between lg:gap-3">
          <WerbebudgetRangeSwitch />
          <WerbekontenAction connected={period.connected} canConnect={canConnect} className="hidden lg:inline-flex" />
        </div>

        <ParamViewsSlot param={WB_PARAM} value={range} className="space-y-4 md:space-y-6">
          <WerbebudgetPeriodBody {...period} />
        </ParamViewsSlot>
      </div>
    </ParamViews>
  );
}
