"use server";

import { DASHBOARD_RANGE_KEYS, parseDashboardRange } from "@/lib/dashboard-range";
import { DashboardDetailLoader, DashboardTopMetricsLoader } from "./_components/loaders";

/**
 * The period-dependent parts of the Übersicht for one period, rendered on the
 * server for the client cache in RangeViews. Every card gets the same period,
 * like the page-level switch writes it. The loaders check the session
 * themselves, so this returns nothing a signed-out caller could not see.
 */
export async function loadDashboardRange(value: string) {
  const range = parseDashboardRange(value);
  const searchParams = Promise.resolve(
    Object.fromEntries(Object.values(DASHBOARD_RANGE_KEYS).map((key) => [key, range]))
  );
  return {
    top: <DashboardTopMetricsLoader searchParams={searchParams} />,
    detail: <DashboardDetailLoader searchParams={searchParams} />,
  };
}
