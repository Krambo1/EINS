import { Suspense } from "react";
import { requireSession } from "@/auth/guards";
import {
  DashboardDetailLoader,
  DashboardTopMetricsLoader,
} from "./_components/loaders";
import { DetailBundleSkeleton, TopMetricsSkeleton } from "./_components/DetailBundleSkeleton";
import {
  DashboardRangeSwitch,
  DashboardRangeSwitchSkeleton,
} from "./_components/DashboardRangeSwitch";
import { DashboardRangeProvider, RangeSlot } from "./_components/RangeViews";
import {
  AnomalyAlertsWidget,
  AnomalyAlertsSkeleton,
} from "./_components/AnomalyAlertsWidget";

export const metadata = { title: "Übersicht" };

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // The page shell renders SYNCHRONOUSLY: every async dependency lives inside
  // one of the Suspense boundaries below, so the shell paints at once and a
  // slow query only holds its own card.
  //
  // Switching the period does not navigate. DashboardRangeProvider keeps the
  // two period-dependent parts (Kennzahlen + the cards under them, and the
  // detail bundle) per period on the client: the server renders them here for
  // the period in the URL, `loadDashboardRange` renders any other period on
  // demand and in advance while the page is idle, and the switch only swaps
  // which view is shown and rewrites the URL. Revisiting a period is instant,
  // and React keeps the same elements, so numbers and bars animate to their
  // new values.
  return (
    <DashboardRangeProvider>
      {/* The nav already says where we are; the heading is for screen readers.
          Outside the stack: as its first child it would still push the first
          visible block down by one spacing step. */}
      <h1 className="sr-only">Übersicht</h1>
      {/* One spacing step between every block, the same as the gap between the
          cards inside a row, so the page reads as one grid. */}
      <div className="space-y-4 md:space-y-6">
        {/* One range switch for every card (writes all per-card params at
            once, so deep links and loaders stay unchanged). On the phone it
            sticks under the header while scrolling. */}
        <Suspense fallback={<DashboardRangeSwitchSkeleton />}>
          <DashboardRangeSwitch />
        </Suspense>

        {/* Top metrics: the headline tiles, Offene Anfragen and Quellen. */}
        <Suspense fallback={<TopMetricsSkeleton />}>
          <RangeSlot slot="top">
            <DashboardTopMetricsLoader searchParams={searchParams} />
          </RangeSlot>
        </Suspense>

        {/* Anomaly alerts: rule-based detection with optional KI-sauce on the
            rare extreme/multi-signal cases. Not tied to the period. */}
        <Suspense fallback={<AnomalyAlertsSkeleton />}>
          <AnomalyAlertsLoader />
        </Suspense>

        {/* Deep dive: Trichter, Behandlungen, Standorte, Reputation. */}
        <Suspense fallback={<DetailBundleSkeleton />}>
          <RangeSlot slot="detail">
            <DashboardDetailLoader searchParams={searchParams} />
          </RangeSlot>
        </Suspense>
      </div>
    </DashboardRangeProvider>
  );
}

/** Anomaly alerts wrapped so it sources the session itself (cached). */
async function AnomalyAlertsLoader() {
  const session = await requireSession();
  return (
    <AnomalyAlertsWidget clinicId={session.clinicId} userId={session.userId} />
  );
}
