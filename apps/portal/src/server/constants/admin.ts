/**
 * Admin-side platform thresholds and configurable numbers.
 *
 * Source of truth for the tone-thresholds the admin UI uses to colour
 * health/leaderboard signals. Mirrors the EINS Visuals "Grundlagen"
 * Notion page for CPL/CPP targets.
 */

import type { Plan } from "@/lib/constants";

export const KPI_THRESHOLDS = {
  /** Cost per qualified lead, EUR. <40 = good, 40–60 = warn, >60 = bad. */
  cpl: { good: 40, warn: 60 },
  /** Cost per won case, EUR. <200 = good, 200–400 = warn, >400 = bad. */
  cpp: { good: 200, warn: 400 },
  /** Return on ad spend. >=3 = good, 1.5–3 = warn, <1.5 = bad. */
  roas: { good: 3, warn: 1.5 },
  /** No-show rate (0..1). <=10% = good, 10–20% = warn, >20% = bad. */
  noShow: { good: 0.1, warn: 0.2 },
  /** Median first-contact response time, minutes. <=30 = good, 30–120 = warn. */
  responseTimeMin: { good: 30, warn: 120 },
} as const;

/**
 * Monthly retainer per plan, EUR. Placeholder values — Karam to fill in
 * when ready. The leaderboard MRR column reads from here.
 */
export const PLAN_PRICING_EUR: Record<Plan, number> = {
  standard: 0,
  erweitert: 0,
};

export type ToneKey = "good" | "warn" | "bad" | "neutral";

/** Lower-is-better metric tone (CPL, CPP, no-show, response time). */
export function toneForLowerBetter(
  value: number | null | undefined,
  thresholds: { good: number; warn: number }
): ToneKey {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (value <= thresholds.good) return "good";
  if (value <= thresholds.warn) return "warn";
  return "bad";
}

/** Higher-is-better metric tone (ROAS). */
export function toneForHigherBetter(
  value: number | null | undefined,
  thresholds: { good: number; warn: number }
): ToneKey {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (value >= thresholds.good) return "good";
  if (value >= thresholds.warn) return "warn";
  return "bad";
}

/**
 * Composite clinic-health tone from the dimensions the leaderboard cares
 * about. ROAS is the dominant signal; CPL is the secondary screen.
 */
export function clinicHealthTone(args: {
  spend: number;
  revenue: number;
  cpl: number | null;
}): ToneKey {
  if (args.spend <= 0 && args.revenue <= 0) return "neutral";
  const roas = args.spend > 0 ? args.revenue / args.spend : 0;
  if (roas >= KPI_THRESHOLDS.roas.good) return "good";
  if (roas >= KPI_THRESHOLDS.roas.warn) return "warn";
  return "bad";
}
