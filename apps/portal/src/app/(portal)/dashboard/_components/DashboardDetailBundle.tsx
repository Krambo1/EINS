import "server-only";
import Link from "next/link";
import { ChevronRight, Minus, Star, TrendingDown, TrendingUp } from "lucide-react";
import {
  Avatar,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@eins/ui";
import { kpiSummaryWithComparison } from "@/server/queries/kpis";
import { bySource } from "@/server/queries/attribution";
import { staffPerformance } from "@/server/queries/lifecycle";
import { recallsDue } from "@/server/queries/patients";
import { latestReviews, reviewTrend } from "@/server/queries/reviews";
import {
  formatEuro,
  formatNumber,
  formatMinutes,
  formatPercent,
  formatRelative,
  formatRelativeDay,
} from "@/lib/formatting";
import {
  SOURCE_LABELS,
  type RequestSource,
} from "@/lib/constants";
import { BreakdownStackChart } from "../../auswertung/_components/BreakdownStackChart";
import type { BreakdownTone } from "../../auswertung/_components/detail-helpers";
import type { KpiSummary } from "@/server/queries/kpis";
import { platformLabelNode, type Platform } from "../../bewertungen/_lib/platforms";
import {
  DASHBOARD_RANGE_KEYS,
  dashboardRangeWindow,
  type DashboardRange,
} from "@/lib/dashboard-range";
import { TimeRangeToggle } from "./TimeRangeToggle";

/**
 * Async server component rendered inside a <Suspense>. Fetches the deep-dive
 * detail bundle (7 parallel queries) and renders the cards that show beyond
 * the base shell. The base shell paints immediately while these queries run.
 *
 * The TTFB win: the <h1>, top-metrics skeleton, and traffic-light cards all
 * paint before this bundle's queries finish. On a cold load that previously
 * blocked on max-of-13 queries before any bytes flushed, the shell now
 * blocks on max-of-5.
 */
export async function DashboardDetailBundle({
  clinicId,
  userId,
  summary,
  staffRange,
  sourcesRange,
}: {
  clinicId: string;
  userId: string;
  summary: KpiSummary;
  staffRange: DashboardRange;
  sourcesRange: DashboardRange;
}) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  // Staff and Quellen cards have their own range toggles; everything else on
  // this bundle still uses the current calendar month.
  const staffWin = dashboardRangeWindow(staffRange);
  const sourcesWin = dashboardRangeWindow(sourcesRange);

  const [comparison, sourceBreakdown, staff, recalls, reviews, reviewsTrend] =
    await Promise.all([
      kpiSummaryWithComparison(clinicId, userId, monthStart, monthEnd),
      bySource(clinicId, userId, sourcesWin.from, sourcesWin.to),
      staffPerformance(clinicId, userId, staffWin.from, staffWin.to),
      // Dashboard card only surfaces what's actually a *manual* to-do:
      // open leads waiting for a Nachfass. `recall` lives in the Praxis's
      // PVS; `review_request` is fully automated by the review-request
      // worker. Putting either on a to-do list is misleading.
      recallsDue(clinicId, userId, 30, ["followup"]),
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

  void comparison; // currently consumed only by the top-metrics enhanced tile path

  // Source-matrix totals: same row slice as the chart so the footer sums what
  // the user actually sees. ROAS is spend-weighted (Σ revenue / Σ spend) — an
  // arithmetic mean of per-source ROAS over-weights low-spend channels.
  const sourceRows = sourceBreakdown.slice(0, 6);
  const sourceTotals = sourceRows.reduce(
    (acc, r) => {
      acc.leads += r.leads;
      if (r.spendEur != null) acc.spend += r.spendEur;
      acc.revenue += r.revenueEur ?? 0;
      return acc;
    },
    { leads: 0, spend: 0, revenue: 0 },
  );
  const sourceTotalRoas =
    sourceTotals.spend > 0 ? sourceTotals.revenue / sourceTotals.spend : null;
  // Total-ROAS tone uses the same absolute thresholds as per-source ROAS so
  // the footer visibly answers "is the channel mix profitable overall?"
  const sourceTotalRoasTone: BreakdownTone | null = roasToneFor(sourceTotalRoas);

  // Per-cell tones for the leads and budget columns. Absolute thresholds for
  // either column would be domain-arbitrary (a "good" lead count varies wildly
  // by practice size), so we rank within the visible row set instead:
  //   - Anfragen: top tertile = good, bottom tertile = warn (need ≥2 rows).
  //   - Budget: same idea applied to CPL (spend/leads). Cheapest acquisition
  //     wins, most expensive flags. Rows without spend OR leads don't qualify.
  const leadsToneBySource = rankTones(
    sourceRows.map((r) => ({ key: r.source, value: r.leads })),
    "asc"
  );
  const cplCandidates = sourceRows
    .filter((r) => r.spendEur != null && r.spendEur > 0 && r.leads > 0)
    .map((r) => ({ key: r.source, value: r.spendEur! / r.leads }));
  // For CPL, lower is better — invert the rank direction so the cheapest CPL
  // gets the "good" tone.
  const budgetToneBySource = rankTones(cplCandidates, "desc");

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={`print:break-inside-avoid${staff.length === 0 ? " lg:col-span-2" : ""}`}>
          <CardHeader className="items-start gap-4">
            <TimeRangeToggle
              value={sourcesRange}
              paramKey={DASHBOARD_RANGE_KEYS.sources}
              ariaLabel="Zeitraum für Quellen-Aufschlüsselung"
            />
            <CardTitle>Quellen-Aufschlüsselung</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownStackChart
              centerLabel="Anfragen"
              emptyText="Keine Quellen-Daten."
              legendColumns={[
                { label: "Anfragen" },
                { label: "Budget" },
                { label: "ROAS" },
              ]}
              totalsRow={{
                label: "Gesamt",
                stats: [
                  formatNumber(sourceTotals.leads),
                  sourceTotals.spend > 0 ? formatEuro(sourceTotals.spend) : null,
                  sourceTotalRoas != null
                    ? `${sourceTotalRoas.toFixed(1).replace(".", ",")}×`
                    : null,
                ],
                statTones: [null, null, sourceTotalRoasTone],
              }}
              slices={sourceRows.map((c) => {
                const labelStr =
                  SOURCE_LABELS[c.source as RequestSource] ?? c.source;
                return {
                  key: c.source,
                  labelText: labelStr,
                  value: c.leads,
                  stats: [
                    formatNumber(c.leads),
                    c.spendEur != null ? formatEuro(c.spendEur) : null,
                    c.roas != null
                      ? `${c.roas.toFixed(1).replace(".", ",")}×`
                      : null,
                  ],
                  statTones: [
                    leadsToneBySource.get(c.source) ?? null,
                    budgetToneBySource.get(c.source) ?? null,
                    roasToneFor(c.roas),
                  ],
                  tone: sourceTone(c.source),
                };
              })}
            />
          </CardContent>
        </Card>

        {staff.length > 0 && (
          <Card className="print:break-inside-avoid">
            <CardHeader className="items-start gap-4">
              <TimeRangeToggle
                value={staffRange}
                paramKey={DASHBOARD_RANGE_KEYS.staff}
                ariaLabel="Zeitraum für Mitarbeiter-Leistung"
              />
              <CardTitle>Mitarbeiter-Leistung</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-2 grid grid-cols-[1fr_repeat(4,minmax(0,5rem))] gap-4 text-[10px] uppercase tracking-wide text-fg-tertiary">
                <span>&nbsp;</span>
                <span className="text-right">Zugewiesen</span>
                <span className="text-right">Gewonnen</span>
                <span className="text-right">Quote</span>
                <span className="text-right">Ø Reaktion</span>
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {staff.map((s) => (
                  <li
                    key={s.userId}
                    className="grid grid-cols-[1fr_repeat(4,minmax(0,5rem))] items-center gap-4 py-3 text-sm"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Avatar
                        src={s.avatarUrl}
                        name={s.fullName ?? s.email}
                        size="md"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-fg-primary">
                          {s.fullName ?? s.email}
                        </span>
                        <span className="truncate text-xs text-fg-secondary">
                          {s.role}
                        </span>
                      </span>
                    </span>
                    <span className="text-right tabular-nums text-fg-secondary">
                      {formatNumber(s.assignedCount)}
                    </span>
                    <span className="text-right tabular-nums text-fg-secondary">
                      {formatNumber(s.wonCount)}
                    </span>
                    <span className={`text-right tabular-nums font-medium ${winRateToneClass(s.winRate)}`}>
                      {s.winRate != null ? formatPercent(s.winRate) : "–"}
                    </span>
                    <span className={`text-right tabular-nums font-medium ${responseToneClass(s.avgResponseMinutes)}`}>
                      {formatMinutes(s.avgResponseMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
              {(() => {
                const totals = staff.reduce(
                  (acc, s) => {
                    acc.assigned += s.assignedCount;
                    acc.won += s.wonCount;
                    if (s.avgResponseMinutes != null) {
                      acc.responseSum += s.avgResponseMinutes;
                      acc.responseCount += 1;
                    }
                    return acc;
                  },
                  { assigned: 0, won: 0, responseSum: 0, responseCount: 0 },
                );
                // Team-Quote = Σ gewonnen / Σ zugewiesen — not the mean of
                // individual rates, which would over-weight low-volume staff.
                const teamRate =
                  totals.assigned > 0 ? totals.won / totals.assigned : null;
                const teamResponse =
                  totals.responseCount > 0
                    ? totals.responseSum / totals.responseCount
                    : null;
                return (
                  <div className="grid grid-cols-[1fr_repeat(4,minmax(0,5rem))] items-center gap-4 border-t-2 border-border bg-bg-secondary/40 py-3 text-sm">
                    <span className="flex items-center gap-3 min-w-0">
                      {/* Matches Avatar size="md" (h-9 w-9) so the label
                          aligns with the staff names above. */}
                      <span aria-hidden className="h-9 w-9 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-fg-primary">
                          Team gesamt
                        </span>
                        <span className="truncate text-xs text-fg-secondary">
                          {staff.length === 1
                            ? "1 Mitarbeiter:in"
                            : `${formatNumber(staff.length)} Mitarbeiter:innen`}
                        </span>
                      </span>
                    </span>
                    <span className="text-right font-semibold tabular-nums text-fg-primary">
                      {formatNumber(totals.assigned)}
                    </span>
                    <span className="text-right font-semibold tabular-nums text-fg-primary">
                      {formatNumber(totals.won)}
                    </span>
                    <span className={`text-right font-semibold tabular-nums ${winRateToneClass(teamRate)}`}>
                      {teamRate != null ? formatPercent(teamRate) : "–"}
                    </span>
                    <span className={`text-right font-semibold tabular-nums ${responseToneClass(teamResponse)}`}>
                      {formatMinutes(teamResponse)}
                    </span>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="print:break-inside-avoid">
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
                        <span className="flex items-center gap-1.5 font-semibold tabular-nums">
                          <RatingDelta
                            current={r.rating}
                            previous={previousRatingByPlatform.get(r.platform) ?? null}
                          />
                          {r.rating.toFixed(1).replace(".", ",")}
                          <Star className="h-4 w-4 text-tone-warn" />
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
                        <span className="flex items-center gap-1.5 font-semibold tabular-nums">
                          {weightedAvg.toFixed(1).replace(".", ",")}
                          <Star className="h-4 w-4 text-tone-warn" />
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

        <Card className="print:break-inside-avoid">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Offene Leads</CardTitle>
              <CardDescription>
                Anfragen, die in den nächsten 30 Tagen einen Nachfass brauchen
              </CardDescription>
            </div>
            {recalls.length > 0 && (
              <span className="shrink-0 text-2xl font-semibold tabular-nums text-fg-primary">
                {recalls.length}
              </span>
            )}
          </CardHeader>
          <CardContent>
            {recalls.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                Aktuell keine offenen Leads — alles im grünen Bereich.
              </p>
            ) : (
              <div className="space-y-4">
                <ul className="space-y-1 text-sm">
                  {recalls.slice(0, 5).map((r) => {
                    const rel = formatRelativeDay(r.scheduledFor);
                    const name =
                      r.patientName ?? r.patientEmail ?? "Unbekannt";
                    const row = (
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate font-medium text-fg-primary">
                            {name}
                          </span>
                          {r.treatmentLabel && (
                            <span className="truncate text-xs text-fg-secondary">
                              {r.treatmentLabel}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span
                            className={`tabular-nums text-xs ${
                              rel.overdue ? "text-tone-bad" : "text-fg-secondary"
                            }`}
                          >
                            {rel.label}
                          </span>
                          {r.requestId && (
                            <ChevronRight
                              aria-hidden
                              className="h-3.5 w-3.5 text-fg-tertiary"
                            />
                          )}
                        </span>
                      </span>
                    );
                    return (
                      <li key={r.id}>
                        {r.requestId ? (
                          <Link
                            href={`/anfragen/${r.requestId}`}
                            className="-mx-2 block rounded-md px-2 py-1.5 hover:bg-bg-secondary/60"
                          >
                            {row}
                          </Link>
                        ) : (
                          <span className="block px-2 py-1.5">{row}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-fg-tertiary">
                  <span>
                    {recalls.length === 1
                      ? "1 offener Lead"
                      : `${recalls.length} offene Leads`}
                  </span>
                  <Link
                    href="/anfragen"
                    className="text-accent hover:underline"
                  >
                    Alle Anfragen →
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Trichter-Übersicht</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-4">
          <DetailBox
            label="Termine"
            value={formatNumber(summary.appointments)}
            hint={
              summary.qualifiedLeads > 0
                ? `${formatPercent(summary.appointments / summary.qualifiedLeads)} der Anfragen`
                : null
            }
          />
          <DetailBox
            label="Beratungen gehalten"
            value={formatNumber(summary.consultationsHeld)}
            hint={
              summary.appointments > 0
                ? `${formatPercent(
                    summary.consultationsHeld / summary.appointments
                  )} der Termine`
                : null
            }
          />
          <DetailBox
            label="Behandlungen gewonnen"
            value={formatNumber(summary.casesWon)}
            hint={
              summary.consultationsHeld > 0
                ? `${formatPercent(summary.casesWon / summary.consultationsHeld)} der Beratungen`
                : null
            }
          />
          <DetailBox
            label="Kosten je qualifizierter Anfrage"
            value={
              summary.costPerQualifiedLead !== null
                ? formatEuro(summary.costPerQualifiedLead)
                : "–"
            }
            hint={null}
          />
        </CardContent>
      </Card>
    </>
  );
}

// Win-rate semaphore: ≥35 % strong, 20–35 % acceptable, <20 % weak.
// Null (no leads assigned) stays neutral — we have nothing to judge.
function winRateToneClass(rate: number | null | undefined): string {
  if (rate == null) return "text-fg-secondary";
  if (rate >= 0.35) return "text-tone-good";
  if (rate >= 0.2) return "text-tone-warn";
  return "text-tone-bad";
}

// Response-time semaphore: ≤2 h good, 2–8 h warn (still same business day),
// >8 h bad. Null means no contacted leads — neutral.
function responseToneClass(minutes: number | null | undefined): string {
  if (minutes == null) return "text-fg-secondary";
  if (minutes <= 120) return "text-tone-good";
  if (minutes <= 480) return "text-tone-warn";
  return "text-tone-bad";
}

// Distinct slice color per source so the donut never repeats hues.
function sourceTone(source: string): BreakdownTone {
  switch (source) {
    case "meta":
      return "accent";
    case "google":
      return "good";
    case "formular":
      return "warn";
    case "whatsapp":
      return "bad";
    default:
      return "neutral";
  }
}

/** ROAS → tone, shared between per-row and totals row so a 1,2× cell looks the
 *  same regardless of where it appears. Break-even (1×) is the dividing line:
 *  above 2× is comfortably profitable, 1×–2× is fine but margin-thin, below 1×
 *  means the channel costs more than it returns. */
function roasToneFor(roas: number | null | undefined): BreakdownTone | null {
  if (roas == null) return null;
  if (roas >= 2) return "good";
  if (roas >= 1) return "neutral";
  return "warn";
}

/**
 * Rank an array of {key, value} entries and emit tones — top tertile = "good",
 * bottom tertile = "warn", middle stays null. `direction` controls whether
 * larger values are better (`"asc"` → big = good) or smaller (`"desc"` →
 * small = good, used for CPL). Returns a Map<key, tone> so the caller can
 * look up tones by row key without re-sorting.
 */
function rankTones(
  entries: { key: string; value: number }[],
  direction: "asc" | "desc",
): Map<string, BreakdownTone> {
  const out = new Map<string, BreakdownTone>();
  // Need ≥2 entries to make a meaningful comparison — a single row coloured
  // as "best" or "worst" against nothing is just noise.
  if (entries.length < 2) return out;
  const sorted = [...entries].sort((a, b) =>
    direction === "asc" ? b.value - a.value : a.value - b.value
  );
  const tertile = Math.max(1, Math.floor(sorted.length / 3));
  sorted.slice(0, tertile).forEach((e) => out.set(e.key, "good"));
  sorted.slice(sorted.length - tertile).forEach((e) => {
    // Don't overwrite a "good" key when n=2 (top tertile and bottom tertile
    // overlap) — better to drop the warn so a 2-row table isn't both flagged.
    if (!out.has(e.key)) out.set(e.key, "warn");
  });
  return out;
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

function DetailBox({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-fg-tertiary">{hint}</div>}
    </div>
  );
}
