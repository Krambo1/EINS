import "server-only";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { latestReviews, reviewTrend } from "@/server/queries/reviews";
import {
  byLocation,
  byTreatment,
  type LocationBreakdownRow,
  type TreatmentBreakdownRow,
} from "@/server/queries/attribution";
import { listLocations } from "@/server/queries/locations";
import { dashboardPosts } from "@/server/queries/content-dashboard";
import { getStorage } from "@/server/storage";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
  type CurrencyCode,
} from "@/lib/formatting";
import type { KpiSummary, NoShowWindow } from "@/server/queries/kpis";
import { platformLabelNode, type Platform } from "../../bewertungen/_lib/platforms";
import { dashboardRangeWindow, type DashboardRange } from "@/lib/dashboard-range";
import { RatingStars } from "../../_components/RatingStars";
import { CardEmptyNote } from "./card-notes";
import { FIRST_INQUIRY_NOTE, RANGE_SENTENCE_START } from "./range-text";
import { DashCard, RollingNumber } from "./dash-ui";
import { PairedBreakdown, type PairedRow, type PairedTone } from "./PairedBreakdown";
import { ShareBreakdown, type ShareRow } from "./ShareBreakdown";
import { InhalteCard, type InhaltePost } from "./InhalteCard";

/** Preview links live as long as someone may keep the page open. */
const PREVIEW_LINK_SECONDS = 60 * 60;

/**
 * Async server component rendered inside a <Suspense>. Fetches the deep-dive
 * detail bundle in parallel and renders the cards that show beyond the base
 * shell. The base shell paints immediately while these queries run.
 */
export async function DashboardDetailBundle({
  clinicId,
  userId,
  currency,
  summary,
  priorSummary,
  noShow,
  noShowPrior,
  canManageReviews,
  funnelRange,
  locationsRange,
  treatmentsRange,
  postsRange,
  adsRun,
}: {
  clinicId: string;
  userId: string;
  /** Billing currency of this (single) Praxis; formats own-revenue figures. */
  currency: CurrencyCode;
  summary: KpiSummary;
  priorSummary: KpiSummary;
  /** No-Show-Quote of the rNoShow window and of the window before it. */
  noShow: NoShowWindow;
  noShowPrior: NoShowWindow;
  /** Inhaber: may connect review platforms in Einstellungen. */
  canManageReviews: boolean;
  funnelRange: DashboardRange;
  locationsRange: DashboardRange;
  treatmentsRange: DashboardRange;
  /** Period of the Inhalte card (the Quellen's, the posts behind them). */
  postsRange: DashboardRange;
  /**
   * Whether ads ever ran (any Werbebudget in the whole history), the same
   * decision as the Werbeertrag tile: without it the Behandlungen have no
   * Werbeertrag column, in every period.
   */
  adsRun: boolean;
}) {
  // Each breakdown owns its own time window via its own toggle param:
  // `locationsWin` = Standorte (rLocations),
  // `treatmentsWin` = Behandlungen (rTreatments).
  const locationsWin = dashboardRangeWindow(locationsRange);
  const treatmentsWin = dashboardRangeWindow(treatmentsRange);
  // Baseline category list over the widest window, so the Behandlungen card
  // always shows the full set of Behandlungen regardless of the selected
  // range. A sparse window (e.g. "Heute") then renders "–" for categories with
  // no activity instead of dropping rows and looking near-empty. Stable within
  // a day → shared cache hit across range toggles.
  const treatmentsBaselineWin = dashboardRangeWindow("max");
  const postsWin = dashboardRangeWindow(postsRange);
  const [
    reviews,
    reviewsTrend,
    locationBreakdown,
    locations,
    treatmentBreakdown,
    treatmentBaseline,
    postData,
  ] = await Promise.all([
    latestReviews(clinicId, userId),
    // Previous rating per platform → trend arrow on the Reputation card.
    // 6-month window is plenty; snapshots are logged irregularly so we just
    // pick the second-most-recent per platform below.
    reviewTrend(clinicId, userId, 6),
    byLocation(clinicId, userId, locationsWin.from, locationsWin.to),
    listLocations(clinicId, userId),
    // Behandlungen card owns its own time window via the rTreatments toggle.
    byTreatment(clinicId, userId, treatmentsWin.from, treatmentsWin.to),
    byTreatment(
      clinicId,
      userId,
      treatmentsBaselineWin.from,
      treatmentsBaselineWin.to
    ),
    // Inhalte card: the posts of the period and their Anfragen.
    dashboardPosts(clinicId, userId, postsWin.from, postsWin.to),
  ]);

  // Previews: a Mux still for a video, the signed file for a picture.
  // Signed here, outside the cached query, so a link never outlives its cache.
  const storage = getStorage();
  const withPreview = (list: typeof postData.posts): Promise<InhaltePost[]> =>
    Promise.all(
      list.map(async (p) => {
        const a = p.asset;
        const isImage = !!a && (a.kind === "foto" || (a.mimeType ?? "").startsWith("image/"));
        const thumbUrl = a?.muxPlaybackId
          ? `https://image.mux.com/${a.muxPlaybackId}/thumbnail.jpg?time=1`
          : a && isImage
            ? await storage.urlFor(a.storageKey, { expiresInSeconds: PREVIEW_LINK_SECONDS })
            : null;
        return { ...p, thumbUrl };
      })
    );
  const [posts, waitingPosts] = await Promise.all([
    withPreview(postData.posts),
    withPreview(postData.waitingPosts),
  ]);

  // Overlay the selected window's numbers onto the baseline categories;
  // categories with no rows in the window become "–" placeholders so the
  // list stays stable across ranges.
  const treatmentRows = mergeTreatmentRows(treatmentBaseline, treatmentBreakdown);
  // The 5-year baseline lists every Behandlung with at least one non-spam
  // Anfrage, so an empty baseline means the Praxis has no Anfrage yet. Reused
  // for the day-one empty sentences instead of another query.
  const hasAnyRequest = treatmentBaseline.length > 0;

  // Whether to show the Standorte card is purely "is this a multi-location
  // Praxis?" — decided by listLocations, which is range-independent. It must
  // NOT depend on locationBreakdown (the time-windowed query): a sparse
  // window like "Heute" can legitimately return zero rows, and gating on it
  // would make the whole card vanish when the toggle is switched. The
  // empty-window case is handled inside the card with one sentence instead.
  // Single-location Praxen (the common case) show the Standorte card not at
  // all; multi-location Praxen get it as the last full-width card.
  const showLocations = locations.length > 1;

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

  // Every card below the top row runs full width: their heights depend on
  // the data (number of Behandlungen, platforms, Standorte), so pairing them
  // side by side would leave holes. Full width keeps the page one clean grid.
  return (
    <>
      {/* First card of the bundle: right under the Auffälligkeiten, or under
          Quellen when there are none, so its place never depends on them. */}
      <InhalteCard
        posts={posts}
        waitingPosts={waitingPosts}
        waiting={postData.waiting}
        anyOnline={postData.anyOnline}
        range={postsRange}
      />

      <FunnelOverviewCard
        summary={summary}
        priorSummary={priorSummary}
        noShow={noShow}
        noShowPrior={noShowPrior}
        range={funnelRange}
        hasAnyRequest={hasAnyRequest}
      />

      <TreatmentBreakdownCard
        rows={treatmentRows}
        range={treatmentsRange}
        currency={currency}
        hasAnyRequest={hasAnyRequest}
        adsRun={adsRun}
      />

      <ReputationCard
        reviews={reviews}
        previousRatingByPlatform={previousRatingByPlatform}
        canManageReviews={canManageReviews}
      />

      {showLocations && (
        <MultiLocationCard
          rows={withEveryLocation(locationBreakdown, locations)}
          slots={locations.length + 1}
          currency={currency}
        />
      )}
    </>
  );
}

/**
 * Every Standort keeps its row in every period: one without an Anfrage in the
 * window is added with zeros (shown as "–"), so the list does not grow and
 * shrink with the period. "Ohne Standort" only comes from the query.
 */
function withEveryLocation(
  rows: LocationBreakdownRow[],
  locations: { id: string; name: string }[]
): LocationBreakdownRow[] {
  const have = new Set(rows.map((r) => r.locationId));
  const missing = locations
    .filter((l) => !have.has(l.id))
    .map((l) => ({
      locationId: l.id,
      locationName: l.name,
      leads: 0,
      appointments: 0,
      casesWon: 0,
      revenueEur: 0,
    }));
  return [...rows, ...missing];
}

/** Zero values (and "–" for no activity) recede so the rows with activity
 *  stand out. */
function zeroTone(value: number | null): PairedTone | null {
  return value == null || value === 0 ? "muted" : null;
}

/** "25 % der Anfragen": share of the Anfragen that were won. */
function wonShare(won: number | null, leads: number | null): string | undefined {
  if (won == null || leads == null || leads <= 0) return undefined;
  return `${Math.round((won / leads) * 100)} % der Anfragen`;
}

/** Sum of a column; null when no row has a value. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, v) => a + v, 0) : null;
}

/** Screen-reader sentence for the Behandlungen chart. */
function pairedChartLabel(what: string, rows: PairedRow[]): string {
  return `Anfragen und gewonnene Behandlungen je ${what}: ${rows
    .filter((r) => r.anfragen != null)
    .map((r) => `${r.name} ${r.anfragen} Anfragen, ${r.gewonnen ?? 0} gewonnen`)
    .join("; ")}`;
}

/** Reputation keeps one height whatever the platforms: room for three rows on
 *  the phone, one row of columns from sm. More (or longer) scroll. */
const REPUTATION_SPACE = "h-[11.5rem] sm:h-[5.25rem]";

type Review = Awaited<ReturnType<typeof latestReviews>>[number];

/**
 * Reputation: one column per platform (rating, stars, count, trend) and the
 * weighted Gesamt when there is more than one platform. Phone: one compact
 * row each.
 */
function ReputationCard({
  reviews,
  previousRatingByPlatform,
  canManageReviews,
}: {
  reviews: Review[];
  previousRatingByPlatform: Map<string, number>;
  canManageReviews: boolean;
}) {
  if (reviews.length === 0) {
    return (
      <DashCard title="Bewertungen" href="/bewertungen">
        <div className={cn(REPUTATION_SPACE, "flex flex-col items-center justify-center gap-3 text-center")}>
          <CardEmptyNote>Füllt sich, sobald eine Bewertungsplattform verbunden ist.</CardEmptyNote>
          {/* Bewertungen are synced from the connected platforms (manual
              entry was removed), and only the Inhaber can connect them. */}
          {canManageReviews && (
            <Link
              href="/einstellungen#bewertungen"
              className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-accent"
            >
              Bewertungsplattformen verbinden
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </DashCard>
    );
  }
  // Weighted average across platforms: a simple mean would over-weight a
  // low-volume platform (one Jameda rating counting as much as 200 Google).
  const totalCount = reviews.reduce((a, r) => a + r.totalCount, 0);
  const weightedAvg =
    totalCount > 0
      ? reviews.reduce((a, r) => a + r.rating * r.totalCount, 0) / totalCount
      : null;
  const cells: { key: string; label: ReactNode; rating: number; count: number; delta: ReactNode }[] =
    reviews.map((r) => ({
      key: r.id,
      label: platformLabelNode(r.platform as Platform),
      rating: r.rating,
      count: r.totalCount,
      delta: (
        <RatingDelta current={r.rating} previous={previousRatingByPlatform.get(r.platform) ?? null} />
      ),
    }));
  if (reviews.length > 1 && weightedAvg != null) {
    cells.push({ key: "gesamt", label: "Gesamt", rating: weightedAvg, count: totalCount, delta: null });
  }
  const cols = ["", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4"][
    Math.min(cells.length, 4)
  ];
  return (
    <DashCard title="Bewertungen" href="/bewertungen">
      <div className={cn(REPUTATION_SPACE, "scroll-shadows [--scroll-bg:var(--surface-tile)]")}>
      <ul className={cn("grid divide-y divide-border sm:divide-x sm:divide-y-0", cols)}>
        {cells.map((c) => (
          // Phone: one compact row (name and count left, rating right).
          // sm+: a column per platform, stacked in DOM order.
          <li
            key={c.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3 first:pt-0 last:pb-0 sm:block sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0"
          >
            <div className="text-[15px] font-medium text-fg-primary">{c.label}</div>
            <div className="row-span-2 flex items-center gap-2 sm:mt-1.5">
              <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-fg-primary sm:text-[1.75rem]">
                {c.rating.toFixed(1).replace(".", ",")}
              </span>
              <RatingStars rating={c.rating} size={14} />
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-sm tabular-nums text-fg-secondary sm:mt-1.5">
              {formatNumber(c.count)} Bewertungen
              {c.delta}
            </div>
          </li>
        ))}
      </ul>
      </div>
    </DashCard>
  );
}

/**
 * Standorte of a multi-location Praxis: one share bar each for Anfragen,
 * Termine, Gewonnen and Umsatz, split by Standort, over rows with the same
 * figures and a Gesamt row (rows and Gesamt like the Behandlungen card).
 * Rows arrive sorted by Anfragen from the query; "Ohne Standort" rolls up
 * Anfragen without a Standort and stays grey.
 */
function MultiLocationCard({
  rows,
  slots,
  currency,
}: {
  rows: LocationBreakdownRow[];
  /** Row slots the list keeps (every Standort plus "Ohne Standort"). */
  slots: number;
  currency: CurrencyCode;
}) {
  const active = (r: LocationBreakdownRow) =>
    r.leads > 0 || r.appointments > 0 || r.casesWon > 0 || r.revenueEur > 0;
  const shares: ShareRow[] = rows.map((r, idx) => ({
    key: r.locationId ?? `ohne-${idx}`,
    name: r.locationName,
    unassigned: r.locationId == null,
    values: [r.leads, r.appointments, r.casesWon, r.revenueEur],
    // A Standort without activity in the window shows "–", like Behandlungen.
    cells: active(r)
      ? [
          formatNumber(r.leads),
          formatNumber(r.appointments),
          formatNumber(r.casesWon),
          formatMoney(r.revenueEur, currency),
        ]
      : ["–", "–", "–", "–"],
    tones: [zeroTone(r.leads), zeroTone(r.appointments), zeroTone(r.casesWon), zeroTone(r.revenueEur)],
    card: [
      { label: "Anfragen", value: formatNumber(r.leads) },
      { label: "Termine", value: formatNumber(r.appointments) },
      { label: "Gewonnen", value: formatNumber(r.casesWon), extra: wonShare(r.casesWon, r.leads) },
      { label: "Umsatz", value: formatMoney(r.revenueEur, currency) },
    ],
  }));
  return (
    <DashCard title="Standorte" href="/anfragen" className="relative hover:z-20">
      {/* --slots: rows the list keeps room for (80 px each on the phone, where
          a row has a second and third line; 44 px from lg). More rows scroll. */}
      <div style={{ "--slots": slots } as CSSProperties}>
        <ShareBreakdown
          nameLabel="Standort"
          metrics={["Anfragen", "Termine", "Gewonnen", "Umsatz"]}
          columns={[
            { label: "Anfragen", phone: true },
            { label: "Termine" },
            { label: "Gewonnen" },
            { label: "Umsatz" },
          ]}
          rows={shares}
          emptyText={
            rows.some(active)
              ? undefined
              : "Im gewählten Zeitraum ist an keinem Standort eine Anfrage eingegangen."
          }
          listClassName="h-[calc(var(--slots)*5rem)] lg:h-[calc(var(--slots)*2.75rem)]"
          total={
            rows.some(active)
              ? [
                  formatNumber(rows.reduce((a, r) => a + r.leads, 0)),
                  formatNumber(rows.reduce((a, r) => a + r.appointments, 0)),
                  formatNumber(rows.reduce((a, r) => a + r.casesWon, 0)),
                  formatMoney(rows.reduce((a, r) => a + r.revenueEur, 0), currency),
                ]
              : ["–", "–", "–", "–"]
          }
          chartLabel={`Anteile der Standorte: ${rows
            .map(
              (r) =>
                `${r.locationName} ${formatNumber(r.leads)} Anfragen, ${formatNumber(r.appointments)} Termine, ${formatNumber(r.casesWon)} gewonnen, ${formatMoney(r.revenueEur, currency)}`
            )
            .join("; ")}`}
        />
      </div>
    </DashCard>
  );
}

/**
 * Change of a platform rating since the previous snapshot, styled like the
 * other changes on the page (arrow and coloured number). A 0.05-star
 * deadband keeps a 4.65 → 4.69 wobble silent, and with no previous snapshot
 * there is nothing to show.
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
  if (abs < 0.05) return null;
  const up = diff > 0;
  const formatted = `${up ? "+" : "−"}${abs.toFixed(1).replace(".", ",")}`;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium",
        up ? "text-tone-good" : "text-tone-bad"
      )}
      aria-label={up ? `Bewertung um ${formatted} gestiegen` : `Bewertung um ${formatted} gefallen`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {formatted}
    </span>
  );
}

// ---------- Trichter ----------
//
// Four steps (Anfragen → Termine → Beratungen gehalten → Behandlungen
// gewonnen), drawn like Attio's funnel steps: the step's count as a solid
// bar, behind it a light tint up to the step before, so the drop-off between
// two steps shows without reading a number. Under the count the share of the
// step before ("how many did I lose here?"). Columns from xl, where every
// label fits on one line; below that one row per step, bars left to right.
//
// Footer: Kosten pro qualifizierter Anfrage and the No-Show-Quote, each with its change
// against the period before (rFunnel / rNoShow drive the windows in
// page.tsx). Both are lower-is-better, so falling numbers read green.
function FunnelOverviewCard({
  summary,
  priorSummary,
  noShow,
  noShowPrior,
  range,
  hasAnyRequest,
}: {
  summary: KpiSummary;
  priorSummary: KpiSummary;
  noShow: NoShowWindow;
  noShowPrior: NoShowWindow;
  range: DashboardRange;
  hasAnyRequest: boolean;
}) {
  const stages: FunnelStageData[] = [
    { label: "Anfragen", value: summary.leads, prevValue: null, prevLabel: null },
    {
      label: "Termine",
      value: summary.appointments,
      prevValue: summary.leads,
      prevLabel: "der Anfragen",
    },
    {
      label: "Beratungen gehalten",
      value: summary.consultationsHeld,
      prevValue: summary.appointments,
      prevLabel: "der Termine",
    },
    {
      label: "Behandlungen gewonnen",
      value: summary.casesWon,
      prevValue: summary.consultationsHeld,
      prevLabel: "der Beratungen",
    },
  ];
  const top = stages[0]!.value;
  const empty = top === 0;
  const hasNoShow = noShow.appointments > 0;
  const hasCost = summary.costPerQualifiedLead !== null;
  const costSub = hasCost
    ? `${formatEuro(summary.spendEur)} für ${formatNumber(summary.qualifiedAdLeads)} ${
        summary.qualifiedAdLeads === 1 ? "qualifizierte Anfrage" : "qualifizierte Anfragen"
      }.`
    : summary.spendEur > 0
      ? "Keine qualifizierte Anfrage aus Anzeigen."
      : "Kein Werbebudget im Zeitraum.";

  return (
    <DashCard title="Trichter" href="/anfragen" bodyClassName="px-0 pb-0 pt-4 md:px-0 md:pb-0">
      <div className="relative px-5 pb-5 md:px-6 md:pb-6">
        {/* Without Anfragen the steps keep their space (hidden) and one
            sentence sits in the middle of it: the card never collapses. */}
        {empty && (
          <p className="absolute inset-x-5 top-0 bottom-5 flex items-center justify-center text-center text-[15px] leading-5 text-fg-secondary md:inset-x-6 md:bottom-6">
            {!hasAnyRequest
              ? FIRST_INQUIRY_NOTE
              : range === "heute"
                ? "Heute ist noch keine Anfrage eingegangen."
                : `${RANGE_SENTENCE_START[range]} ist keine Anfrage eingegangen.`}
          </p>
        )}
        <div className={cn(empty && "invisible")} aria-hidden={empty || undefined}>
          <ol className="space-y-5 xl:hidden">
            {stages.map((s, i) => (
              <FunnelStepRow key={s.label} stage={s} top={top} index={i} />
            ))}
          </ol>
          {/* gap-6 = the page gutter: the gap between steps 2 and 3 sits right
              under the gap between the two cards above. */}
          <ol className="hidden grid-cols-4 gap-6 xl:grid">
            {stages.map((s, i) => (
              <FunnelStepColumn key={s.label} stage={s} top={top} index={i} />
            ))}
          </ol>
        </div>
      </div>
      {/* Both figures always have their cell: one without a value shows "–"
          and says why, so the footer has one height. Stacked between md and
          lg: the sidebar makes the card too narrow there for both labels on
          one line. From xl the two figures sit on the Trichter's four columns
          (under steps 1 and 3), so their left edges line up with the steps
          above. */}
      <div className="grid divide-y divide-border border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 md:grid-cols-1 md:divide-x-0 md:divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0 xl:grid-cols-4 xl:gap-6 xl:divide-x-0 xl:px-6">
        <FooterStat
          className="xl:col-span-2 xl:px-0"
          label="Kosten pro qualifizierter Anfrage"
          info={
            <ExplainerPopover term="Kosten pro qualifizierter Anfrage">
              <p>
                Werbebudget im Zeitraum geteilt durch die qualifizierten
                Anfragen, die über Anzeigen gekommen sind.
              </p>
              <p className="mt-2">
                Qualifiziert heißt: über einen EINS-Messweg eingegangen, mit
                Telefonnummer oder E-Mail, kein Spam. Anfragen über Ihre
                Beiträge kosten kein Werbebudget und zählen hier nicht mit.
              </p>
            </ExplainerPopover>
          }
          value={hasCost ? formatEuro(summary.costPerQualifiedLead!) : "–"}
          note={
            hasCost ? (
              <CostPerLeadDelta
                current={summary.costPerQualifiedLead}
                previous={priorSummary.costPerQualifiedLead}
              />
            ) : undefined
          }
          sub={costSub}
        />
        <FooterStat
          className="xl:col-span-2 xl:px-0"
          label="No-Show-Quote"
          info={
            <ExplainerPopover term="No-Show-Quote">
              <p>
                Anteil der vereinbarten Termine, zu denen Patienten nicht
                erschienen sind.
              </p>
              <p className="mt-2">
                Über den Zeitraum nach Terminzahl gewichtet, damit einzelne Tage
                mit wenigen Terminen die Quote nicht verzerren.
              </p>
            </ExplainerPopover>
          }
          value={hasNoShow ? formatPercent(noShow.rate) : "–"}
          note={hasNoShow ? <NoShowDelta current={noShow.rate} previous={noShowPrior.rate} /> : undefined}
          sub={
            hasNoShow
              ? `${formatNumber(noShow.noShows)} von ${formatNumber(noShow.appointments)} Terminen nicht wahrgenommen.`
              : "Keine Termine im Zeitraum."
          }
        />
      </div>
    </DashCard>
  );
}

/** One figure in the Trichter footer: label, number with its change, a line of context. */
function FooterStat({
  label,
  info,
  value,
  note,
  sub,
  className,
}: {
  className?: string;
  label: string;
  info?: ReactNode;
  value: string;
  note?: ReactNode;
  sub?: string;
}) {
  return (
    <div className={cn("min-w-0 px-5 py-4 md:px-6 md:py-5", className)}>
      {/* Fixed height so the info icon does not lower this number below its neighbour's. */}
      <div className="flex h-5 items-center gap-1 text-[15px] font-medium leading-5 text-fg-primary">
        {label}
        {info}
      </div>
      {/* One step below the Trichter counts: these support the card, they are not its subject. */}
      <div className="mt-1.5 flex h-8 flex-wrap items-baseline gap-x-2 gap-y-1">
        <RollingNumber
          value={value}
          className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-fg-primary"
        />
        {note}
      </div>
      {/* The line keeps its room even without text. */}
      <p className="mt-1.5 min-h-5 text-sm text-fg-secondary">{sub}</p>
    </div>
  );
}

/**
 * Change of the No-Show-Quote in percentage points vs the prior window.
 * Lower is better, so a falling quote reads green. A 0,5-Pp. deadband keeps
 * small wobble silent (no "unverändert" label: no change, no text).
 */
function NoShowDelta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  if (current == null || previous == null) return null;
  const diffPp = (current - previous) * 100;
  const abs = Math.abs(diffPp);
  if (abs < 0.5) return null;
  const improved = diffPp < 0;
  const formatted = `${abs.toFixed(1).replace(".", ",")} Pp. ${improved ? "niedriger" : "höher"}`;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-sm font-medium tabular-nums",
        improved ? "text-tone-good" : "text-tone-bad"
      )}
      aria-label={`No-Show-Quote ${formatted} vs. Vorperiode`}
    >
      {formatted}
    </span>
  );
}

/**
 * Change of Kosten pro qualifizierter Anfrage vs the prior window: "X € günstiger" in green
 * or "X € teurer" in red; under 0,50 € nothing at all.
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
  if (abs < 0.5) return null;
  const improved = diff < 0;
  const formatted = `${formatEuro(abs)} ${improved ? "günstiger" : "teurer"}`;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-sm font-medium tabular-nums",
        improved ? "text-tone-good" : "text-tone-bad"
      )}
      aria-label={`Kosten pro qualifizierter Anfrage ${formatted} vs. Vorperiode`}
    >
      {formatted}
    </span>
  );
}

interface FunnelStageData {
  label: string;
  value: number;
  /** Previous stage's count for the "X % der vorherigen Stufe" line.
   *  null on the top stage (Anfragen has no upstream). */
  prevValue: number | null;
  /** "der Anfragen", "der Termine", ... */
  prevLabel: string | null;
}

/** Bar length as a share of the top step. A 2 % floor keeps a non-zero step
 *  visible as a stub; a step at zero stays empty. */
export function barSize(value: number, top: number): string {
  if (value <= 0 || top <= 0) return "0%";
  return `${Math.max(2, (value / top) * 100)}%`;
}

/**
 * Stagger for one step: its bar grows a beat after the step before it, and
 * the drop-off tint (`.bar-ghost`, recessed into the card behind the bar)
 * fades in just after its bar. The whole Trichter stands within about 0.6 s.
 */
export function stepDelays(index: number): { bar: CSSProperties; ghost: CSSProperties } {
  return {
    bar: { "--delay": `${index * 40}ms` } as CSSProperties,
    ghost: { "--delay": `${120 + index * 40}ms` } as CSSProperties,
  };
}

/** "25 % der Anfragen": the share stands out, the reference stays quiet. */
function StepShare({ stage, className }: { stage: FunnelStageData; className?: string }) {
  if (stage.prevValue == null || stage.prevValue <= 0) return null;
  return (
    <p className={cn("text-sm tabular-nums text-fg-secondary", className)}>
      <span className="font-medium text-fg-primary">
        {Math.round((stage.value / stage.prevValue) * 100)} %
      </span>{" "}
      {stage.prevLabel}
    </p>
  );
}

/** Below xl: label and count on one line, the bar under them, then the share. */
function FunnelStepRow({ stage, top, index }: { stage: FunnelStageData; top: number; index: number }) {
  // Where the tint shows past the bar, the bar ends square against it.
  const cut = stage.prevValue != null && stage.value < stage.prevValue;
  const delay = stepDelays(index);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium text-fg-primary">{stage.label}</span>
        <RollingNumber
          value={formatNumber(stage.value)}
          className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-fg-primary"
        />
      </div>
      <div className="relative mt-2 h-4" aria-hidden>
        {stage.prevValue != null && (
          <div
            className="bar-ghost anim-ghost absolute inset-y-0 left-0 rounded-[var(--r-small)]"
            style={{ width: barSize(stage.prevValue, top), ...delay.ghost }}
          />
        )}
        <div
          className={cn("bar-solid anim-bar-x absolute inset-y-0 left-0", cut ? "rounded-l-[var(--r-small)]" : "rounded-[var(--r-small)]")}
          style={{ width: barSize(stage.value, top), ...delay.bar }}
        />
      </div>
      <div className="mt-1.5 h-5">
        <StepShare stage={stage} />
      </div>
    </li>
  );
}

/** xl: label, count and share on top, the bar rising from the shared baseline. */
function FunnelStepColumn({ stage, top, index }: { stage: FunnelStageData; top: number; index: number }) {
  const cut = stage.prevValue != null && stage.value < stage.prevValue;
  const delay = stepDelays(index);
  return (
    <li className="flex min-w-0 flex-col">
      <span className="text-[15px] font-medium leading-5 text-fg-primary">{stage.label}</span>
      <RollingNumber
        value={formatNumber(stage.value)}
        className="mt-1.5 font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-fg-primary"
      />
      {/* Fixed height: the first step has no share, its bar must still start level. */}
      <div className="mt-2 h-5">
        <StepShare stage={stage} />
      </div>
      <div className="relative mt-4 h-44" aria-hidden>
        {stage.prevValue != null && (
          <div
            className="bar-ghost anim-ghost absolute inset-x-0 bottom-0 rounded-t-[var(--r-card)]"
            style={{ height: barSize(stage.prevValue, top), ...delay.ghost }}
          />
        )}
        <div
          className={cn("bar-solid anim-bar-y absolute inset-x-0 bottom-0", !cut && "rounded-t-[var(--r-card)]")}
          style={{ height: barSize(stage.value, top), ...delay.bar }}
        />
      </div>
    </li>
  );
}

interface TreatmentDisplayRow {
  treatmentId: string | null;
  treatmentName: string;
  /** null → keine Aktivität im gewählten Fenster, wird als "–" gerendert. */
  leads: number | null;
  casesWon: number | null;
  revenueEur: number | null;
  avgCaseValueEur: number | null;
  /** Werbeertrag (ROAS) im Fenster; null wenn kein Budget zuzuordnen ist. */
  roas: number | null;
}

/**
 * Overlay a window's per-treatment numbers onto a baseline category list
 * (computed over the widest window). Categories missing from the window keep
 * their name but get null values, so the Behandlungen card shows a stable set
 * of Behandlungen across every range and renders "–" where a sparse window
 * (e.g. "Heute") has no data, instead of dropping rows.
 */
function mergeTreatmentRows(
  baseline: TreatmentBreakdownRow[],
  windowRows: TreatmentBreakdownRow[]
): TreatmentDisplayRow[] {
  const keyOf = (r: TreatmentBreakdownRow) => r.treatmentId ?? r.treatmentName;
  const inWindow = new Map(windowRows.map((r) => [keyOf(r), r] as const));
  return baseline.map((b) => {
    const w = inWindow.get(keyOf(b));
    return {
      treatmentId: b.treatmentId,
      treatmentName: b.treatmentName,
      leads: w ? w.leads : null,
      casesWon: w ? w.casesWon : null,
      revenueEur: w ? w.revenueEur : null,
      avgCaseValueEur: w ? w.avgCaseValueEur : null,
      roas: w ? w.roas : null,
    };
  });
}

/** Werbeertrag tone, same break-even bands as the Quellen: from 2× good,
 *  from 1× neutral, below 1× a warning. */
function roasTone(roas: number | null): PairedTone | null {
  if (roas == null) return "muted";
  if (roas >= 2) return "good";
  if (roas >= 1) return "quiet";
  return "warn";
}

/**
 * Behandlungen, full width, in the Quellen process: Attio's paired bars per
 * Behandlung (Anfragen light, Gewonnen solid) over Stripe's rows with
 * Anfragen, Gewonnen, Umsatz and Werbeertrag and a Gesamt row. The set of
 * Behandlungen is fixed over the widest window (see mergeTreatmentRows), so
 * every period shows the same rows; "Sonstige" rolls up Anfragen without a
 * Behandlung. Zeros recede (grey) instead of being hidden. A Praxis that
 * never ran ads (organic start) has no Werbeertrag column at all.
 */
function TreatmentBreakdownCard({
  rows,
  range,
  currency,
  hasAnyRequest,
  adsRun,
}: {
  rows: TreatmentDisplayRow[];
  range: DashboardRange;
  currency: CurrencyCode;
  hasAnyRequest: boolean;
  adsRun: boolean;
}) {
  // Baseline categories exist but none has activity in this window: one
  // sentence instead of a table of dashes.
  const windowEmpty = rows.every((r) => r.leads == null);
  // Werbeertrag only says something where there is Umsatz to compare.
  const roasText = (r: TreatmentDisplayRow) =>
    r.roas != null && (r.revenueEur ?? 0) > 0 ? `${r.roas.toFixed(1).replace(".", ",")}×` : null;
  const paired: PairedRow[] = rows.map((r) => {
    const roas = roasText(r);
    return {
      key: r.treatmentId ?? r.treatmentName,
      name: r.treatmentName,
      anfragen: r.leads,
      gewonnen: r.casesWon,
      // No activity in this window (mergeTreatmentRows): "–", not a blank row.
      cells: [
        r.leads != null ? formatNumber(r.leads) : "–",
        r.casesWon != null ? formatNumber(r.casesWon) : "–",
        r.revenueEur != null ? formatMoney(r.revenueEur, currency) : "–",
        ...(adsRun ? [roas] : []),
      ],
      tones: [
        zeroTone(r.leads),
        zeroTone(r.casesWon),
        zeroTone(r.revenueEur),
        ...(adsRun ? [roasTone(r.roas)] : []),
      ],
      card: [
        { label: "Anfragen", value: formatNumber(r.leads ?? 0) },
        {
          label: "Gewonnen",
          value: formatNumber(r.casesWon ?? 0),
          extra: wonShare(r.casesWon, r.leads),
        },
        { label: "Umsatz", value: formatMoney(r.revenueEur ?? 0, currency) },
        ...(roas ? [{ label: "Werbeertrag", value: roas }] : []),
      ],
    };
  });
  const totalLeads = sumOrNull(rows.map((r) => r.leads));
  const totalWon = sumOrNull(rows.map((r) => r.casesWon));
  const totalRevenue = sumOrNull(rows.map((r) => r.revenueEur));
  return (
    <DashCard
      title="Behandlungen"
      href="/anfragen"
      className="relative hover:z-20"
      titleExtra={
        adsRun ? (
          <ExplainerPopover term="Werbeertrag">
            <p>
              Werbeertrag: wie viel Umsatz aus Anfragen über Anzeigen je 1 €
              Werbebudget bei dieser Behandlung zurückkommt. 3,0× heißt 3 €
              Umsatz je 1 € Werbebudget.
            </p>
            <p className="mt-2">
              Das Werbebudget wird den Behandlungen nach ihrem Anteil an den
              Anfragen über Anzeigen zugeordnet, da es nicht je Behandlung
              erfasst wird. Umsatz aus Beiträgen und Empfehlungen zählt hier
              nicht mit.
            </p>
          </ExplainerPopover>
        ) : undefined
      }
    >
      {/* Chart, rows and Gesamt keep their frame in every state: with nothing
          to show, one sentence takes the rows' space. The rows' space has a
          fixed height (more rows, or longer ones on the phone, scroll). */}
      <PairedBreakdown
        nameLabel="Behandlung"
        columns={[
          { label: "Anfragen" },
          { label: "Gewonnen", phone: true },
          { label: "Umsatz", phone: true },
          ...(adsRun ? [{ label: "Werbeertrag" }] : []),
        ]}
        rows={paired}
        emptyText={
          !hasAnyRequest || rows.length === 0
            ? FIRST_INQUIRY_NOTE
            : windowEmpty
              ? range === "heute"
                ? "Heute ist noch keine Anfrage eingegangen."
                : `${RANGE_SENTENCE_START[range]} ist keine Anfrage eingegangen.`
              : undefined
        }
        listClassName="h-[24rem] lg:h-[27.5rem]"
        total={[
          totalLeads != null ? formatNumber(totalLeads) : "–",
          totalWon != null ? formatNumber(totalWon) : "–",
          totalRevenue != null ? formatMoney(totalRevenue, currency) : "–",
          ...(adsRun ? [null] : []),
        ]}
        chartLabel={pairedChartLabel("Behandlung", paired)}
      />
    </DashCard>
  );
}
