import "server-only";
import Link from "next/link";
import { ArrowDown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from "@eins/ui";
import { latestReviews, reviewTrend } from "@/server/queries/reviews";
import {
  formatEuro,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/formatting";
import type { KpiSummary } from "@/server/queries/kpis";
import { platformLabelNode, type Platform } from "../../bewertungen/_lib/platforms";
import {
  DASHBOARD_RANGE_KEYS,
  type DashboardRange,
} from "@/lib/dashboard-range";
import { TimeRangeToggle } from "./TimeRangeToggle";
import { RatingStars } from "../../_components/RatingStars";

/**
 * Async server component rendered inside a <Suspense>. Fetches the deep-dive
 * detail bundle in parallel and renders the cards that show beyond the base
 * shell. The base shell paints immediately while these queries run.
 */
export async function DashboardDetailBundle({
  clinicId,
  userId,
  summary,
  priorSummary,
  funnelRange,
}: {
  clinicId: string;
  userId: string;
  summary: KpiSummary;
  priorSummary: KpiSummary;
  funnelRange: DashboardRange;
}) {
  const [reviews, reviewsTrend] = await Promise.all([
    latestReviews(clinicId, userId),
    // Previous rating per platform → trend arrow on the Reputation card.
    // 6-month window is plenty; snapshots are logged irregularly so we just
    // pick the second-most-recent per platform below.
    reviewTrend(clinicId, userId, 6),
  ]);

  // Per-platform previous rating: most recent snapshot that isn't the current
  // one. Map keyed by platform so the JSX can look it up without re-scanning.
  const previousRatingByPlatform = new Map<string, number>();
  {
    const grouped = new Map<string, { rating: number; recordedAt: Date }[]>();
    for (const row of reviewsTrend) {
      const arr = grouped.get(row.platform) ?? [];
      arr.push({ rating: row.rating, recordedAt: row.recordedAt });
      grouped.set(row.platform, arr);
    }
    for (const [platform, rows] of grouped) {
      // reviewTrend orders ascending by recordedAt — newest is last. Skip the
      // newest (== current snapshot in `reviews`) and take whatever comes
      // before it. Fewer than 2 rows = no prior to compare against.
      if (rows.length < 2) continue;
      previousRatingByPlatform.set(platform, rows[rows.length - 2]!.rating);
    }
  }

  return (
    <>
      <FunnelOverviewCard
        summary={summary}
        priorSummary={priorSummary}
        range={funnelRange}
      />

      <div className="grid gap-6">
        <Card
          className="print:break-inside-avoid"
          style={{
            backgroundColor: "var(--bg-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <CardHeader>
            <CardTitle>Reputation</CardTitle>
          </CardHeader>
          <CardContent>
            {reviews.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-fg-secondary">
                  Noch keine Bewertungen erfasst.
                </p>
                <Link
                  href="/bewertungen"
                  className="self-start text-sm text-accent hover:underline"
                >
                  Erste Bewertung hinzufügen →
                </Link>
              </div>
            ) : (
              (() => {
                // Weighted average across platforms — a simple mean would
                // over-weight a low-volume platform (e.g. one Jameda rating
                // counting as much as 200 Google ratings).
                const totalCount = reviews.reduce((a, r) => a + r.totalCount, 0);
                const weightedAvg =
                  totalCount > 0
                    ? reviews.reduce((a, r) => a + r.rating * r.totalCount, 0) /
                      totalCount
                    : null;
                const latestRecordedAt = reviews.reduce<Date | null>(
                  (latest, r) =>
                    latest == null || r.recordedAt > latest ? r.recordedAt : latest,
                  null
                );
                return (
                  <div className="space-y-3">
                    {reviews.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between text-base"
                      >
                        <span className="text-fg-primary">
                          {platformLabelNode(r.platform as Platform)}
                        </span>
                        <span className="flex items-center gap-2 font-semibold tabular-nums">
                          <RatingDelta
                            current={r.rating}
                            previous={previousRatingByPlatform.get(r.platform) ?? null}
                          />
                          {r.rating.toFixed(1).replace(".", ",")}
                          <RatingStars rating={r.rating} size={14} />
                          <span className="ml-1 text-sm font-normal text-fg-secondary">
                            ({formatNumber(r.totalCount)})
                          </span>
                        </span>
                      </div>
                    ))}
                    {reviews.length > 1 && weightedAvg != null && (
                      <div className="flex items-center justify-between border-t border-border pt-3 text-base">
                        <span className="font-semibold text-fg-primary">
                          Gesamt
                        </span>
                        <span className="flex items-center gap-2 font-semibold tabular-nums">
                          {weightedAvg.toFixed(1).replace(".", ",")}
                          <RatingStars rating={weightedAvg} size={14} />
                          <span className="ml-1 text-sm font-normal text-fg-secondary">
                            ({formatNumber(totalCount)})
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-3 text-xs text-fg-tertiary">
                      <span>
                        {latestRecordedAt
                          ? `Aktualisiert ${formatRelative(latestRecordedAt)}`
                          : ""}
                      </span>
                      <Link
                        href="/bewertungen"
                        className="text-accent hover:underline"
                      >
                        Alle Bewertungen →
                      </Link>
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/**
 * Tiny trend chip next to a platform rating: up / down / flat arrow with the
 * signed delta tucked in. Uses a 0.05-star deadband so a 4.65 → 4.69 wobble
 * doesn't flag as "improved" — matches the deadband convention in `deltaTone`.
 * Returns `null` when there is no prior snapshot to compare against (first
 * time a platform appears) so the row just shows the current rating cleanly.
 */
function RatingDelta({
  current,
  previous,
}: {
  current: number;
  previous: number | null;
}) {
  if (previous == null) return null;
  const diff = current - previous;
  const abs = Math.abs(diff);
  const Icon = abs < 0.05 ? Minus : diff > 0 ? TrendingUp : TrendingDown;
  const toneClass =
    abs < 0.05
      ? "text-fg-tertiary"
      : diff > 0
        ? "text-tone-good"
        : "text-tone-bad";
  const formatted =
    abs < 0.05
      ? null
      : `${diff > 0 ? "+" : "−"}${abs.toFixed(1).replace(".", ",")}`;
  return (
    <span
      className={`mr-1 inline-flex items-center gap-0.5 text-xs font-medium ${toneClass}`}
      aria-label={
        abs < 0.05
          ? "Bewertung unverändert"
          : diff > 0
            ? `Bewertung um ${formatted} gestiegen`
            : `Bewertung um ${formatted} gefallen`
      }
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {formatted}
    </span>
  );
}

// ---------- Trichter-Übersicht ----------
//
// Vertical funnel: 4 stages (Anfragen → Termine → Beratungen → Behandlungen),
// each row is a label + count + horizontal bar whose width encodes the share
// of the top stage (Anfragen). The conversion % shown under each stage label
// is "of the previous stage" — the focal question at every step is "how many
// did I lose here?".
//
// Footer surfaces Kosten je Anfrage with a delta chip vs the prior window of
// equal length (rFunnel param drives both windows in page.tsx). Lower CPL is
// the desired direction, so the up-trend arrow + green tone fires when the
// current value sits below prior.
function FunnelOverviewCard({
  summary,
  priorSummary,
  range,
}: {
  summary: KpiSummary;
  priorSummary: KpiSummary;
  range: DashboardRange;
}) {
  const stages: FunnelStageData[] = [
    { label: "Anfragen", value: summary.leads, prevValue: null },
    {
      label: "Termine",
      value: summary.appointments,
      prevValue: summary.leads,
    },
    {
      label: "Beratungen gehalten",
      value: summary.consultationsHeld,
      prevValue: summary.appointments,
    },
    {
      label: "Behandlungen gewonnen",
      value: summary.casesWon,
      prevValue: summary.consultationsHeld,
    },
  ];
  const top = stages[0]!.value;
  const empty = top === 0;

  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <CardTitle>Trichter-Übersicht</CardTitle>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            />
            Anfrage zu Behandlung
          </span>
        </div>
        <TimeRangeToggle
          value={range}
          paramKey={DASHBOARD_RANGE_KEYS.funnel}
          ariaLabel="Zeitraum für Trichter-Übersicht"
        />
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-6 text-sm text-fg-secondary">
            Im gewählten Zeitraum sind noch keine Anfragen eingegangen.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {stages.map((s, i) => (
              <FunnelStageRow
                key={s.label}
                stage={s}
                top={top}
                stageIndex={i}
                isLast={i === stages.length - 1}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <div className="mt-4 flex flex-col gap-1.5 border-t border-border px-6 pb-5 pt-6">
        <span className="text-sm font-medium text-fg-tertiary">
          Kosten je Anfrage
        </span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-3xl font-semibold leading-none tabular-nums text-fg-primary">
            {summary.costPerLead !== null ? formatEuro(summary.costPerLead) : "–"}
          </span>
          <CostPerLeadDelta
            current={summary.costPerLead}
            previous={priorSummary.costPerLead}
          />
        </div>
      </div>
    </Card>
  );
}

interface FunnelStageData {
  label: string;
  value: number;
  /** Previous stage's count for the "X % der vorherigen Stufe" conversion.
   *  null on the top stage (Anfragen has no upstream). */
  prevValue: number | null;
}

function FunnelStageRow({
  stage,
  top,
  stageIndex,
  isLast,
}: {
  stage: FunnelStageData;
  top: number;
  stageIndex: number;
  isLast: boolean;
}) {
  const widthPct = top > 0 ? (stage.value / top) * 100 : 0;
  const stepConv =
    stage.prevValue != null && stage.prevValue > 0
      ? stage.value / stage.prevValue
      : null;
  // Per-stage mint ramp: each row's gradient darkens slightly so the funnel
  // reads as deepening intensity from top to bottom. Final stage swaps to a
  // mint→teal gradient with a soft glow to mark the "won" outcome, and its
  // count flips to the good tone for at-a-glance celebration.
  const fillBackground = isLast
    ? "linear-gradient(90deg, var(--accent), #2f8e88)"
    : `linear-gradient(90deg, rgba(88,186,181,${0.50 + stageIndex * 0.08}), rgba(88,186,181,${0.68 + stageIndex * 0.06}))`;
  const fillShadow = isLast ? "0 4px 16px -4px rgba(88,186,181,0.45)" : undefined;
  // Step-conversion quality tone. Thresholds are intentionally generic across
  // stages (no domain rule says e.g. Termin→Beratung should be evaluated
  // differently from Anfrage→Termin yet). >=60 % good, 40–60 % warn, <40 % bad.
  const convTone: "good" | "warn" | "bad" | null =
    stepConv == null ? null : stepConv >= 0.6 ? "good" : stepConv >= 0.4 ? "warn" : "bad";
  const convToneClass =
    convTone === "good" ? "text-tone-good"
      : convTone === "warn" ? "text-tone-warn"
        : convTone === "bad" ? "text-tone-bad"
          : "text-fg-tertiary";
  return (
    <li className="flex flex-col gap-1.5">
      {stepConv != null && (
        // Mirrors the bar/count row layout so the chip sits in the same right
        // column as the count, with both centered → arrow+% reads as a
        // vertical "drop" from one count to the next. Coloured by quality so
        // leaks read at a glance: green good, yellow warn, red bad.
        <div className="-mt-1.5 flex items-center gap-3.5">
          <div className="flex-1" aria-hidden />
          <span
            aria-label={`Konversion von der vorherigen Stufe: ${formatPercent(stepConv)}`}
            className={cn(
              "inline-flex w-16 shrink-0 items-center justify-center gap-1.5 text-sm font-semibold tabular-nums",
              convToneClass,
            )}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
            {formatPercent(stepConv).replace(/\s/g, "")}
          </span>
        </div>
      )}
      <span className="text-sm font-medium text-fg-secondary">{stage.label}</span>
      <div className="flex items-center gap-3.5">
        <div className="relative h-9 flex-1 overflow-hidden rounded bg-bg-secondary">
          <div
            className="absolute inset-y-0 left-0 rounded transition-[width] duration-500 ease-out"
            // 2 % floor keeps a non-zero stage visible as a tiny stub instead
            // of disappearing. A truly-zero stage stays at 0 and reads as
            // "empty".
            style={{
              width: stage.value > 0 ? `${Math.max(2, widthPct)}%` : "0%",
              background: fillBackground,
              boxShadow: fillShadow,
            }}
          />
        </div>
        <span
          className={cn(
            "w-16 shrink-0 text-center font-display text-2xl font-semibold leading-none tabular-nums",
            isLast ? "text-tone-good" : "text-fg-primary",
          )}
        >
          {formatNumber(stage.value)}
        </span>
      </div>
    </li>
  );
}

/**
 * Delta chip for Kosten je Anfrage. Direction-of-improvement coloring:
 *   current < prior  → "X € günstiger" + TrendingUp + green
 *   current > prior  → "X € teurer"    + TrendingDown + red
 *   |delta| < 0,50 € → flat (no chip, just stays silent)
 * If either value is null we have nothing to compare and render nothing.
 */
function CostPerLeadDelta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  const abs = Math.abs(diff);
  // Half-euro deadband — keeps small daily wobble from constantly toggling
  // the chip between green/red on a freshly-tracked clinic.
  if (abs < 0.5) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-tertiary">
        <Minus className="h-4 w-4" aria-hidden />
        unverändert
      </span>
    );
  }
  const improved = diff < 0;
  const Icon = improved ? TrendingUp : TrendingDown;
  const toneClass = improved ? "text-tone-good" : "text-tone-bad";
  const formatted = `${formatEuro(abs)} ${improved ? "günstiger" : "teurer"}`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums",
        toneClass,
      )}
      aria-label={`Kosten je Anfrage ${formatted} vs. Vorperiode`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {formatted}
      <span className="font-normal text-fg-tertiary"> vs. Vorperiode</span>
    </span>
  );
}
