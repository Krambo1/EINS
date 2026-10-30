/**
 * Shared by the Werbebudget page, its period switch and its skeleton, so the
 * skeleton has the page's sizes by construction (DESIGN.md section 10,
 * "Fixed size").
 */

import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE } from "@/lib/dashboard-range";

/**
 * The period as ParamViews keeps it (instant-views.tsx): the Übersicht's four
 * periods (Heute, 30 Tage, 12 Monate, 5 Jahre), one view each, 30 Tage
 * without a param in the address. parseDashboardRange reads it.
 */
export const WB_PARAM = "zeitraum";
export const WB_RANGE_VALUES: readonly string[] = DASHBOARD_RANGES;
export const WB_DEFAULT_RANGE: string = DEFAULT_DASHBOARD_RANGE;

/**
 * Width of every action on the page: the one at the right end of the first
 * row and each platform row's. One width in every state ("verbinden" without
 * accounts, "verwalten" with, a row's "Facebook-Seite auswählen"), so none
 * moves or changes size.
 */
export const WB_ACTION_WIDTH = "w-[9.5rem] sm:w-[14.5rem]";

/**
 * The Kampagnen list keeps one height whatever the period brings: room for
 * five two-line rows on the phone, six one-line rows from lg (a usual
 * account has fewer). More campaigns, or names that wrap, scroll inside it.
 */
export const WB_CAMPAIGN_LIST_HEIGHT = "h-[21.5rem] lg:h-[17rem]";

/**
 * Columns of the Plattformen rows from xl (Stripe's table: the name with the
 * row's action takes the rest, the three figures in fixed columns). The same
 * columns as the Kampagnen table below, so the two share one grid. Below xl
 * each platform is a block: name and action, status, then the figures.
 */
export const WB_PLATFORM_COLUMNS = "xl:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_12rem]";

/**
 * Columns of the Kampagnen table from lg, the same as the Plattformen's, so
 * the figures stand under each other. Below lg a row is the name with its
 * Werbebudget, then one meta line.
 */
export const WB_CAMPAIGN_COLUMNS =
  "grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_12rem]";
