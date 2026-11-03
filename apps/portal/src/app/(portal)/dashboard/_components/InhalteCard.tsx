import "server-only";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Image as ImageIcon } from "lucide-react";
import { cn } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { formatDate, formatNumber } from "@/lib/formatting";
import { CONTENT_FORMAT_LABELS, type ContentFormat } from "@/lib/content-status";
import type { DashboardRange } from "@/lib/dashboard-range";
import type { DashboardPost } from "@/server/queries/content-dashboard";
import { FORMAT_ICON, POST_STATUS } from "../../inhalte/_lib/view";
import { StatusDot } from "../../inhalte/_components/parts";
import { CONTROL, DashCard, RAISED_CONTROL, TABLE_HEAD_BAND, WASH_AREA, WASH_ROW } from "./dash-ui";
import { RANGE_SENTENCE_START } from "./range-text";

/** A post of the card with its preview already resolved (signed or Mux). */
export type InhaltePost = DashboardPost & { thumbUrl: string | null };

/** Slots of the card: four tiles from xl, four rows below. */
const SLOTS = 4;

/** The table's columns from lg: the post, then Anfragen and Gewonnen. */
const ROW_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_6rem_6rem]";

/** A zero is quieter than a real number. */
function toneOf(n: number): string {
  return n > 0 ? "text-fg-primary" : "text-fg-tertiary";
}

/**
 * Inhalte on the Übersicht: which posts brought Anfragen in the period.
 *
 * Copied from video platforms (references/SOURCES-2026-10-30.md): from xl
 * Frame.io's four-column media grid and YouTube Studio's shelves (picture on
 * top, the format in its corner, the title, then the facts), with Triple
 * Whale's label and value pairs in grey chips; from lg Wistia's "Most played
 * videos" and Buffer's "Performance per Post" (a 16:9 picture, the title with
 * one line below it, numbers in fixed columns under a head band); below lg
 * (the phone, and the narrow column beside the sidebar from md) Frame.io's
 * mobile list. A post waiting for the Freigabe fills a free
 * slot with its status and the action in place of the numbers (Frame.io's
 * "Needs Review" card, Meta Business Suite's buttons under a post). Matched
 * to the Inhalte page: status as dot and text, its head band, the same format
 * names. The title leads to Inhalte, like every card title on the Übersicht.
 *
 * Full width under the Auffälligkeiten (or right under Quellen when there are
 * none). Fixed slots: fewer posts leave slots empty, none puts one sentence
 * in the same space, so the card keeps its height in every period.
 */
export function InhalteCard({
  posts,
  waitingPosts,
  waiting,
  anyOnline,
  range,
}: {
  posts: InhaltePost[];
  /** Posts waiting for the Freigabe, for the slots the online ones leave free. */
  waitingPosts: InhaltePost[];
  waiting: number;
  anyOnline: boolean;
  range: DashboardRange;
}) {
  // Online posts first, then the ones waiting for the Praxis (YouTube Studio
  // lists drafts beside published videos, with the action in place of the
  // numbers).
  const shown = [...posts, ...waitingPosts].slice(0, SLOTS);
  const empty =
    shown.length > 0
      ? null
      : !anyOnline
        ? "Sobald Ihr erster Beitrag online ist, sehen Sie hier, welche Beiträge Anfragen bringen."
        : range === "heute"
          ? "Heute ist kein Beitrag online."
          : `${RANGE_SENTENCE_START[range]} war kein Beitrag online.`;
  const waitingIds = new Set(waitingPosts.map((p) => p.id));
  // Waiting posts the slots could not take; the header links to them.
  const moreWaiting = waiting - shown.filter((p) => p.status === "zur_freigabe").length;

  return (
    <DashCard
      id="inhalte"
      title="Inhalte"
      href="/inhalte"
      // Only when a waiting post found no slot, right of the title where
      // Wistia keeps its "View analytics": the header keeps its height.
      action={
        moreWaiting > 0 ? (
          <Link
            href="/inhalte#freigabe"
            className="inline-flex items-center gap-1.5 rounded-[var(--r-small)] text-sm font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-tone-warn" />
            {waitingLine(moreWaiting, moreWaiting < waiting)}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : undefined
      }
      titleExtra={
        <ExplainerPopover term="Inhalte">
          <p>
            Ihre Beiträge im gewählten Zeitraum und wie viele Anfragen jeder
            gebracht hat, die meisten zuerst.
          </p>
          <p className="mt-2">
            Gezählt wird jede Anfrage, die über den Link eines Beitrags kam.
            Anfragen über den Profil-Link ohne Beitrag stehen in den Quellen.
          </p>
        </ExplainerPopover>
      }
      className="flex flex-col [--delay:60ms]"
      bodyClassName="flex flex-1 flex-col"
    >
      {/* Below xl: four row slots in a list of fixed height, sized for four
          rows with two-line titles; a longer title wraps and the list scrolls
          instead of the card growing. From lg a table like Wistia's "Most
          played videos" and the Inhalte page: the head band names the fixed
          number columns. Below lg (the card is 470 px wide beside the sidebar
          at md) Frame.io's mobile list, the number with its word on the
          right. A slot is 6rem: 88 px of grey (12 px around a two-line
          title with its status line) and 4 px white above and below inside
          the hairlines (WASH_ROW). */}
      <div className="relative h-[calc(4*6rem+3px)] lg:h-[calc(2.25rem+4*6rem+3px)] xl:hidden">
        {empty ? (
          <Note>{empty}</Note>
        ) : (
          <div className="flex h-full flex-col">
            <div
              aria-hidden
              className={cn("hidden shrink-0 items-center gap-x-4 lg:grid", TABLE_HEAD_BAND, WASH_AREA, ROW_COLUMNS)}
            >
              <span>Beitrag</span>
              <span className="text-right">Anfragen</span>
              <span className="text-right">Gewonnen</span>
            </div>
            <ul className="scroll-shadows -mx-3 min-h-0 flex-1 divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)] lg:mt-1">
              {shown.map((p) => (
                <li key={p.id} className={WASH_ROW}>
                  <Link
                    href={hrefOf(p, waitingIds)}
                    className={cn(
                      "flex min-h-[5.5rem] items-center gap-3 rounded-[var(--r-panel)] py-3 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent lg:grid lg:gap-x-4",
                      WASH_AREA,
                      ROW_COLUMNS
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <Preview
                        post={p}
                        className="h-12 w-12 rounded-[var(--r-control)] lg:w-[5.25rem]"
                        small
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[15px] font-medium leading-5 text-fg-primary">
                          {p.title}
                        </span>
                        <span className="mt-1 block">
                          <StatusLine post={p} />
                        </span>
                      </span>
                    </span>
                    {waitingIds.has(p.id) ? (
                      // Not online yet, so no numbers: the step it waits for
                      // takes their place (Meta Business Suite's row buttons).
                      // Below lg the arrow only, so the title keeps
                      // its width; the status line names the step.
                      <span className="inline-flex shrink-0 items-center justify-end gap-1 text-sm font-medium text-fg-primary lg:col-span-2">
                        <span className="sr-only lg:not-sr-only">Freigeben</span>
                        <ArrowRight className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden />
                      </span>
                    ) : (
                      <>
                        <span className="shrink-0 text-right leading-5 lg:hidden">
                          <span className={cn("block text-[15px] font-semibold tabular-nums", toneOf(p.leads))}>
                            {formatNumber(p.leads)}
                          </span>
                          <span className="block text-sm text-fg-secondary">
                            {p.leads === 1 ? "Anfrage" : "Anfragen"}
                          </span>
                        </span>
                        <span className={cn("hidden text-right text-[15px] font-semibold leading-5 tabular-nums lg:block", toneOf(p.leads))}>
                          <span className="sr-only">Anfragen: </span>
                          {formatNumber(p.leads)}
                        </span>
                        <span className={cn("hidden text-right text-[15px] font-semibold leading-5 tabular-nums lg:block", toneOf(p.won))}>
                          <span className="sr-only">Gewonnen: </span>
                          {formatNumber(p.won)}
                        </span>
                      </>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* From xl: four tiles on the page grid (gap-6, so the middle gap sits
          under the gutter between the half-width cards above). Each tile
          stands raised on the card like Triple Whale's creative tiles and
          Frame.io's cards: the picture flush on top, hairlines between the
          picture, the title and the figures, a deeper shadow on hover. The
          sections have fixed heights, so the lines run level across all four
          tiles. Sized for a tile with its two number rows. */}
      <div className="relative hidden h-[21.5rem] xl:block">
        {empty ? (
          <Note>{empty}</Note>
        ) : (
          <ul className="grid h-full grid-cols-4 gap-6">
            {shown.map((p) => (
              <li key={p.id} className="min-w-0">
                <Link
                  href={hrefOf(p, waitingIds)}
                  className="elev-raised group flex h-full flex-col overflow-hidden rounded-[var(--r-panel)] bg-[var(--surface-raised)] transition-shadow duration-200 ease-out hover:[box-shadow:var(--elev-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Preview post={p} className="h-40 w-full border-b border-border" />
                  <span className="block border-b border-border px-4 py-3">
                    {/* Two lines; a longer title scrolls (as on Inhalte). */}
                    <span className="scroll-shadows block h-10 overflow-y-auto break-words text-[15px] font-medium leading-5 text-fg-primary [--scroll-bg:var(--surface-raised)]">
                      {p.title}
                    </span>
                    <span className="mt-1.5 block">
                      <StatusLine post={p} />
                    </span>
                  </span>
                  {waitingIds.has(p.id) ? (
                    // Not online yet, so no numbers: the step it waits for
                    // takes their place (Frame.io's "Needs Review" card,
                    // Meta Business Suite's buttons under a post).
                    <span className="flex flex-1 items-center px-4">
                      <span
                        className={cn(
                          RAISED_CONTROL,
                          CONTROL,
                          "flex w-full items-center justify-center gap-1.5 border px-3 text-sm font-medium"
                        )}
                      >
                        {/* The long label from 1440 px, where the tile is wide
                            enough; the word alone below, as in the rows. */}
                        <span className="min-[1440px]:hidden">Freigeben</span>
                        <span className="hidden min-[1440px]:inline">Ansehen und freigeben</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </span>
                  ) : (
                    <dl className="flex flex-1 flex-col divide-y divide-border">
                      <Figure label="Anfragen" value={p.leads} />
                      <Figure label="Gewonnen" value={p.won} />
                    </dl>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashCard>
  );
}

/** A waiting post opens in the Freigabe card on Inhalte, any other post the page. */
function hrefOf(post: InhaltePost, waitingIds: Set<string>): string {
  return waitingIds.has(post.id) ? `/inhalte?beitrag=${post.id}#freigabe` : "/inhalte";
}

/**
 * "2 warten auf Freigabe", or "1 weiterer wartet auf Freigabe" beside
 * waiting tiles. Short, so it fits next to the title on the phone.
 */
function waitingLine(n: number, more: boolean): string {
  const count = formatNumber(n);
  if (n === 1) return `${count} ${more ? "weiterer " : ""}wartet auf Freigabe`;
  return `${count} ${more ? "weitere " : ""}warten auf Freigabe`;
}

/** One sentence in the middle of the free slots. */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-[15px] text-fg-secondary">
      {children}
    </p>
  );
}

/** "● Live seit 12.10.2026" or "● Gestoppt seit …", as on Inhalte. */
function StatusLine({ post }: { post: InhaltePost }) {
  const status = POST_STATUS[post.status];
  const since = post.status === "gestoppt" ? post.stoppedAt : post.liveSince;
  return (
    <StatusDot dot={status.dot} className="font-normal text-fg-secondary">
      <span className="font-medium text-fg-primary">{status.label}</span>
      {since && <span className="tabular-nums">seit {formatDate(new Date(since))}</span>}
    </StatusDot>
  );
}

/**
 * Label left, value in a grey chip right (Triple Whale's creative card), one
 * row of the tile's figures with a hairline between the rows.
 */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-1 items-center justify-between gap-3 px-4">
      <dt className="text-sm text-fg-secondary">{label}</dt>
      <dd
        className={cn(
          "rounded-[var(--r-small)] border border-border bg-[var(--well)] px-2 text-[15px] font-semibold leading-6 tabular-nums",
          value > 0 ? "text-fg-primary" : "text-fg-tertiary"
        )}
      >
        {formatNumber(value)}
      </dd>
    </div>
  );
}

/**
 * The post's picture: its file when it has one (a Mux still for a video),
 * else a well with the format's icon, so every slot has the same shape. The
 * row's small picture is pressed into the card; the tile's picture runs flush
 * to the tile's edges and names the format in its corner, where YouTube
 * Studio and Wistia put the duration.
 */
function Preview({
  post,
  className,
  small = false,
}: {
  post: InhaltePost;
  className?: string;
  small?: boolean;
}) {
  const Icon = FORMAT_ICON[post.format] ?? ImageIcon;
  const formatLabel = CONTENT_FORMAT_LABELS[post.format as ContentFormat] ?? post.format;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-[var(--well)] text-fg-tertiary",
        small && "elev-inset",
        className
      )}
    >
      {post.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage and Mux links, no image optimiser
        <img src={post.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Icon aria-hidden className={small ? "h-5 w-5" : "h-7 w-7"} />
      )}
      {!small && (
        <span className="elev-raised absolute bottom-2 right-2 rounded-[var(--r-small)] bg-[var(--surface-raised)] px-2 text-sm font-medium leading-6 text-fg-primary">
          {formatLabel}
        </span>
      )}
    </span>
  );
}
