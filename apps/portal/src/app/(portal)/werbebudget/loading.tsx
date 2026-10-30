import { KpiGrid } from "../dashboard/_components/KpiTiles";
import { PageHeader } from "../_components/PageHeader";
import { WerbebudgetRangeSwitch } from "./_components/WerbebudgetRangeSwitch";
import {
  AdFunnelCell,
  CampaignsCard,
  FigureCell,
  PlatformsCard,
  PrimaryFigureSkeleton,
  WerbekontenAction,
} from "./_components/WerbebudgetParts";

/**
 * The page with its parts in their skeleton form, so every card and button
 * stands where it will stand (DESIGN.md section 10, "Fixed size"). Shown on
 * the first load only: a period switch swaps kept views in the page. The
 * switch is the real one and reads the period from the address.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <PageHeader
        title="Werbebudget"
        className="mb-4 md:mb-6 lg:sr-only"
        actions={<WerbekontenAction connected={null} className="lg:hidden" />}
      />
      <div className="space-y-4 md:space-y-6">
        <div className="lg:flex lg:min-h-[var(--shell-row)] lg:items-center lg:justify-between lg:gap-3">
          <WerbebudgetRangeSwitch />
          <WerbekontenAction connected={null} className="hidden lg:block" />
        </div>
        <KpiGrid primary={<PrimaryFigureSkeleton />}>
          <FigureCell label="Anfragen über Werbung" shortLabel="Anfragen" skeleton />
          <FigureCell label="Pro qualifizierte Anfrage" narrowLabel="Pro qualif. Anfrage" skeleton />
          <AdFunnelCell leads={0} qualified={0} appointments={0} won={0} spend={0} skeleton />
        </KpiGrid>
        <PlatformsCard rows={null} />
        <CampaignsCard rows={null} emptyText="" />
      </div>
    </div>
  );
}
