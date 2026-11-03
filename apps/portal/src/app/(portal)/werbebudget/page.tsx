import { redirect } from "next/navigation";
import {
  DASHBOARD_RANGE_KEYS,
  DEFAULT_DASHBOARD_RANGE,
  parseDashboardRange,
} from "@/lib/dashboard-range";

/**
 * The Werbebudget page is retired (Karam, 2026-10-30): its figures were on
 * the Übersicht already (Werbebudget per source in Quellen, the cost per
 * qualifizierte Anfrage in the Trichter, the Werbeertrag tile), and the ad
 * accounts with their status live in Einstellungen. The address stays for
 * old links and bookmarks and opens the Übersicht. The page's `?zeitraum=`
 * had the Übersicht's four values, so it becomes the Übersicht's period
 * (every card's param, as its switch writes them).
 */
export default async function WerbebudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ zeitraum?: string | string[] }>;
}) {
  const range = parseDashboardRange((await searchParams).zeitraum);
  const query =
    range === DEFAULT_DASHBOARD_RANGE
      ? ""
      : `?${new URLSearchParams(Object.values(DASHBOARD_RANGE_KEYS).map((key) => [key, range])).toString()}`;
  redirect(`/dashboard${query}`);
}
