"use server";

import { requireAdmin } from "@/auth/admin-guards";
import { dashboardRangeDays, parseDashboardRange } from "@/lib/dashboard-range";
import {
  aiScoreDistribution,
  pipelineFunnel,
  platformMix,
  spendRevenueSeries,
} from "@/server/queries/admin";
import { PerformanceSection } from "./_components/PerformanceSection";
import { PipelineSection } from "./_components/PipelineSection";
import { LeistungRangeBody, loadLeistungRange } from "./leistung/_components/LeistungRangeBody";
import { RevenuePeriodBody, loadRevenuePeriod } from "./revenue/_components/RevenuePeriodBody";

/*
 * The period-dependent cards of the admin pages, rendered for one period for
 * the kept views of ParamViews (instant-views.tsx): the period switches swap
 * views without a navigation. Each checks the admin session itself.
 */

/** Werbeleistung card of the Übersicht. */
export async function loadAdminPerformance(value: string) {
  await requireAdmin();
  const range = parseDashboardRange(value);
  const days = dashboardRangeDays(range);
  const [daily, mix] = await Promise.all([spendRevenueSeries(days), platformMix(days)]);
  return <PerformanceSection daily={daily} mix={mix} range={range} />;
}

/** Anfragen card (status and KI-Bewertung) of the Übersicht. */
export async function loadAdminPipeline(value: string) {
  await requireAdmin();
  const range = parseDashboardRange(value);
  const days = dashboardRangeDays(range);
  const [funnel, ai] = await Promise.all([pipelineFunnel(days), aiScoreDistribution(days)]);
  return <PipelineSection funnel={funnel} ai={ai} range={range} />;
}

/** Platform cards and campaigns of /admin/leistung. */
export async function loadAdminLeistung(value: string) {
  await requireAdmin();
  return <LeistungRangeBody {...await loadLeistungRange(parseDashboardRange(value))} />;
}

/** Trend, donut and table per Praxis of /admin/revenue. */
export async function loadAdminRevenue(value: string) {
  await requireAdmin();
  return <RevenuePeriodBody {...await loadRevenuePeriod(value)} />;
}
