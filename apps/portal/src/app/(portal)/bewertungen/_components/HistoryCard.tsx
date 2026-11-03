import { cn } from "@eins/ui";
import { formatDate, formatNumber } from "@/lib/formatting";
import type { listReviews } from "@/server/queries/reviews";
import { DashCard, TABLE_HEAD_BAND } from "../../dashboard/_components/dash-ui";
import { platformLabel, platformLabelNode, type Platform } from "../_lib/platforms";
import { HISTORY_BODY_HEIGHT, HISTORY_ROW_HEIGHT } from "../_lib/sizes";
import { CenteredNote, FeedbackStars } from "./feedback-ui";
import { HistoryExport } from "./HistoryExport";

/**
 * Columns of the header and every row: the figures right-aligned (Stripe).
 * "Neu" (reviews since the platform's stand before) only from sm, where it
 * fits; the phone keeps the four columns instead of cutting any.
 */
const COLUMNS =
  "grid-cols-[6.25rem_minmax(0,1fr)_4.5rem_4rem] sm:grid-cols-[8rem_minmax(0,1fr)_8rem_6rem_6rem]";

const rating1 = (v: number) => v.toFixed(1).replace(".", ",");

/**
 * Every stand of every platform, newest first, as one of Stripe's tables:
 * the header a band pressed into the card (Linear's group header), rows of
 * one height, rating, count and the reviews added since the stand before in
 * fixed columns on the right (Birdeye's table of count and average side by
 * side). "CSV laden" in the header (Uberall's export). The body has room
 * for six rows (two platforms, three stands) and scrolls beyond, so the
 * card keeps one height as stands come in; with none it keeps the frame and
 * says so in its middle (DESIGN.md section 10).
 */
export function HistoryCard({ rows }: { rows: Awaited<ReturnType<typeof listReviews>> }) {
  // Rows are newest first: the stand before is the next row of the platform.
  const added = rows.map((r, i) => {
    const before = rows.slice(i + 1).find((o) => o.platform === r.platform);
    return before ? r.totalCount - before.totalCount : null;
  });

  return (
    <DashCard
      title={
        <>
          Verlauf
          {rows.length > 0 && (
            <span className="ml-2 font-normal tabular-nums text-fg-secondary">{formatNumber(rows.length)}</span>
          )}
        </>
      }
      action={
        rows.length > 0 ? (
          <HistoryExport
            rows={rows.map((r, i) => ({
              date: formatDate(r.recordedAt),
              platform: platformLabel(r.platform),
              rating: rating1(r.rating),
              count: r.totalCount,
              added: added[i] ?? null,
            }))}
          />
        ) : undefined
      }
      className="[--delay:80ms]"
    >
      {/* The band 12 px past the columns at the sides (DESIGN.md section 5), the rows under it. */}
      <div className="-mx-3">
        <div aria-hidden className={cn("grid items-center gap-x-3 px-3 sm:gap-x-4", TABLE_HEAD_BAND, COLUMNS)}>
          <span>Datum</span>
          <span>Plattform</span>
          <span className="text-right">Sterne</span>
          <span className="text-right">Anzahl</span>
          <span className="hidden text-right sm:block">Neu</span>
        </div>
        {rows.length === 0 ? (
          <div className={cn("mt-1 flex", HISTORY_BODY_HEIGHT)}>
            <CenteredNote
              title="Noch kein Stand erfasst."
              text="Sobald Google oder Jameda verbunden ist, steht hier jeder Stand."
            />
          </div>
        ) : (
          <ul
            aria-label="Stände je Plattform"
            className={cn("scroll-shadows mt-1 divide-y divide-border [--scroll-bg:var(--surface-tile)]", HISTORY_BODY_HEIGHT)}
          >
            {rows.map((r, i) => {
              const a = added[i];
              return (
                <li
                  key={r.id}
                  className={cn("grid items-center gap-x-3 px-3 text-[15px] leading-5 text-fg-primary sm:gap-x-4", HISTORY_ROW_HEIGHT, COLUMNS)}
                >
                  <span className="tabular-nums">{formatDate(r.recordedAt)}</span>
                  <span className="min-w-0">{platformLabelNode(r.platform as Platform)}</span>
                  <span className="flex items-center justify-end gap-1.5 font-medium tabular-nums">
                    <span className="sr-only">Bewertung </span>
                    {rating1(r.rating)}
                    <span aria-hidden className="hidden sm:inline-flex">
                      <FeedbackStars rating={r.rating} size={12} />
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="sr-only">Anzahl </span>
                    {formatNumber(r.totalCount)}
                  </span>
                  <span
                    className={cn(
                      "hidden text-right tabular-nums sm:block",
                      a != null && a > 0 ? "font-medium text-tone-good" : "text-fg-secondary"
                    )}
                  >
                    {a != null && (
                      <>
                        <span className="sr-only">Neu seit dem Stand davor </span>
                        {a > 0 ? `+${formatNumber(a)}` : formatNumber(a)}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DashCard>
  );
}
