"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, MessageSquareText, Search } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@eins/ui";
import type { PatientFeedbackStatus } from "@/lib/constants";
import { formatNumber, formatRelative } from "@/lib/formatting";
import { searchParamsUrl, setSearchParams } from "@/app/_components/instant-views";
import {
  CARD_TITLE,
  CONTROL,
  QUIET_CONTROL,
  RAISED_CONTROL,
  WASH_AREA,
  WASH_ROW,
} from "../../../dashboard/_components/dash-ui";
import {
  CenteredNote,
  FeedbackSignal,
  FeedbackStars,
  FeedbackStatus,
  feedbackName,
} from "../../_components/feedback-ui";
import {
  DEFAULT_FEEDBACK_VIEW,
  FEEDBACK_VIEWS,
  FEEDBACK_VIEW_LABELS,
  STAR_BANDS,
  STAR_BAND_LABELS,
  feedbackFilterQuery,
  matchesBandAndSearch,
  matchesFeedback,
  parseFeedbackFilter,
  viewCounts,
  type FeedbackView,
} from "../../_lib/feedback-filter";
import { FEEDBACK_BODY_HEIGHT, FEEDBACK_PAGE_SIZE, FEEDBACK_ROW_HEIGHT } from "../../_lib/sizes";

export interface FeedbackListRow {
  id: string;
  rating: number;
  status: PatientFeedbackStatus;
  source: "private" | "public_redirect";
  publicPlatform: "google" | "jameda" | null;
  contactBackOk: boolean;
  contactName: string | null;
  contactEmail: string | null;
  freeText: string | null;
  createdAt: Date;
}

type Changes = Record<string, string | null>;

/** The menu panel of the Anfragen filters. */
const MENU =
  "min-w-[12rem] rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]";

/**
 * The Rückmeldungen as one card of fixed height (DESIGN.md section 10):
 * search and the star filter in the header, the views as chips with their
 * counts (Linear's inbox views, Podium's counts), ten rows of two lines per
 * page (Linear's inbox rows: the signal slot, the name, bold while new, the
 * age; then the status and the stars), and a pager whose two buttons always
 * stand there.
 *
 * Instant (DESIGN.md section 10, "A view switch is instant"): the server
 * sends every row once, and a chip, the stars, the search and the pager
 * only rewrite the address (`setSearchParams`), so the list switches at
 * once and a reload or a shared link opens the same view. A list at the
 * query's row cap is filtered on the server instead (`instant` false): the
 * filters navigate and the counts come from the server.
 */
export function FeedbackList({
  rows,
  instant,
  serverCounts,
}: {
  rows: FeedbackListRow[];
  instant: boolean;
  /** Counts per view when the server filters; null while the browser does. */
  serverCounts: Record<FeedbackView, number> | null;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const listRef = useRef<HTMLUListElement>(null);

  const filter = parseFeedbackFilter((k) => params.get(k));
  const counts =
    serverCounts ??
    viewCounts(
      rows.reduce<Record<PatientFeedbackStatus, number>>(
        (acc, r) => (matchesBandAndSearch(r, filter) ? { ...acc, [r.status]: acc[r.status] + 1 } : acc),
        { neu: 0, gesehen: 0, beantwortet: 0, geschlossen: 0 }
      )
    );
  const shown = instant ? rows.filter((r) => matchesFeedback(r, filter)) : rows;
  const pages = Math.max(1, Math.ceil(shown.length / FEEDBACK_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.parseInt(params.get("seite") ?? "1", 10) || 1), pages);
  const pageRows = shown.slice((page - 1) * FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE);
  const detailQuery = feedbackFilterQuery(filter);

  /** The address with `changes`, built from the params (also on the server render). */
  function hrefWith(changes: Changes): string {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v == null || v === "") q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

  /** A filter change: in the browser below the cap, a navigation at it. */
  function apply(changes: Changes) {
    const withPage = { ...changes, seite: null };
    if (instant) setSearchParams(withPage);
    else router.push(searchParamsUrl(withPage), { scroll: false });
    listRef.current?.scrollTo({ top: 0 });
  }

  function goToPage(p: number) {
    // Paging is in the browser in both modes: the page holds every row of the filter.
    setSearchParams({ seite: p > 1 ? String(p) : null });
    listRef.current?.scrollTo({ top: 0 });
  }

  /** A link that switches in place on a plain click (instant), else navigates. */
  function onPlainClick(changes: Changes) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      if (!instant || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      apply(changes);
    };
  }

  const viewValue = (v: FeedbackView) => (v === DEFAULT_FEEDBACK_VIEW ? null : v);
  const filtered = filter.band != null || filter.search !== "";
  const from = shown.length === 0 ? 0 : (page - 1) * FEEDBACK_PAGE_SIZE + 1;
  const to = Math.min(page * FEEDBACK_PAGE_SIZE, shown.length);

  return (
    <section
      aria-label="Rückmeldungen"
      className="anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] px-5 pb-5 pt-5 [--delay:20ms] md:px-6 md:pb-6 md:pt-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={CARD_TITLE}>Rückmeldungen</h2>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <SearchField
            value={filter.search}
            instant={instant}
            onChange={(v) => apply({ suche: v || null })}
          />
          <StarFilter band={filter.band} onPick={(b) => apply({ sterne: b })} />
        </div>
      </header>

      <nav aria-label="Ansichten" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {FEEDBACK_VIEWS.map((v) => {
            const active = filter.view === v;
            return (
              <li key={v}>
                <Link
                  href={hrefWith({ status: viewValue(v), seite: null })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  onClick={onPlainClick({ status: viewValue(v) })}
                  className={cn(
                    CONTROL,
                    "inline-flex items-center gap-2 border px-3 text-sm font-medium transition-[color,background-color,box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    active
                      ? RAISED_CONTROL
                      : "border-border text-fg-secondary hover:bg-[var(--hover-wash)] hover:text-fg-primary"
                  )}
                >
                  {FEEDBACK_VIEW_LABELS[v]}
                  {/* A fixed slot, so a chip keeps its width as the count changes. */}
                  <span className={cn("min-w-[3ch] text-right tabular-nums", active ? "text-fg-secondary" : "text-fg-tertiary")}>
                    {formatNumber(counts[v])}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="-mx-3 mt-4">
        {pageRows.length === 0 ? (
          <div className={cn("flex", FEEDBACK_BODY_HEIGHT)}>
            <div className="m-auto flex flex-col items-center">
              <CenteredNote {...emptyNote(filter.view, rows.length === 0 && !filtered, filtered)} />
              {filtered && (
                <button
                  type="button"
                  onClick={() => apply({ sterne: null, suche: null })}
                  className={cn(QUIET_CONTROL, "mt-2")}
                >
                  Suche und Sterne zurücksetzen
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul
            ref={listRef}
            aria-label={`${FEEDBACK_VIEW_LABELS[filter.view]}: Rückmeldungen ${from} bis ${to}`}
            className={cn("scroll-shadows divide-y divide-border px-3 [--scroll-bg:var(--surface-tile)]", FEEDBACK_BODY_HEIGHT)}
          >
            {pageRows.map((r) => (
              // 4 px white inside the hairlines, the wash 12 px past the text (DESIGN.md section 5).
              <li key={r.id} className={WASH_ROW}>
                <Link
                  href={`/bewertungen/feedback/${r.id}${detailQuery}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-[var(--r-panel)] py-3 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    WASH_AREA,
                    FEEDBACK_ROW_HEIGHT
                  )}
                >
                  <FeedbackSignal row={r} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      {/* Long names wrap, never cut; bold while nobody has opened it. */}
                      <span
                        className={cn(
                          "min-w-0 break-words text-[15px] leading-5 text-fg-primary",
                          r.status === "neu" ? "font-semibold" : "font-medium"
                        )}
                      >
                        {feedbackName(r.contactName)}
                      </span>
                      <span suppressHydrationWarning className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">
                        {formatRelative(r.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 flex h-5 items-center gap-3">
                      <FeedbackStatus status={r.status} className="font-normal" />
                      <FeedbackStars rating={r.rating} />
                      {r.source === "private" && r.freeText && (
                        <span className="inline-flex items-center gap-1 text-sm leading-5 text-fg-secondary">
                          <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
                          Mit Text
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Both buttons on every page, greyed at the ends (DESIGN.md section 10). */}
      <footer className="mt-4 flex h-[var(--control-h)] items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-fg-secondary">
          {shown.length === 0 ? "Keine Einträge" : `${formatNumber(from)}-${formatNumber(to)} von ${formatNumber(shown.length)}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className={cn(RAISED_CONTROL, CONTROL, "px-3")}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Zurück
          </Button>
          <Button
            variant="outline"
            disabled={page >= pages}
            onClick={() => goToPage(page + 1)}
            className={cn(RAISED_CONTROL, CONTROL, "px-3")}
          >
            Weiter
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </footer>
    </section>
  );
}

function emptyNote(view: FeedbackView, nothingYet: boolean, filtered: boolean): { title: string; text: string } {
  if (nothingYet)
    return {
      title: "Noch keine Rückmeldungen.",
      text: "Sobald Patienten auf eine Bewertungs-Anfrage antworten, erscheinen sie hier.",
    };
  if (filtered) return { title: "Nichts gefunden.", text: "Keine Rückmeldung passt zu Suche und Sternen in dieser Ansicht." };
  if (view === "offen") return { title: "Alles erledigt.", text: "Keine Rückmeldung wartet auf Ihr Team." };
  return { title: "Keine Rückmeldungen in dieser Ansicht.", text: "Wählen Sie oben eine andere Ansicht." };
}

/**
 * Search over name, e-mail and text. Below the cap every keystroke filters
 * at once; at the cap Enter asks the server.
 */
function SearchField({
  value,
  instant,
  onChange,
}: {
  value: string;
  instant: boolean;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const last = useRef(value);

  // Follow the address when it changes from outside (back, reset).
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);

  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:w-60 sm:flex-none"
      onSubmit={(e) => {
        e.preventDefault();
        last.current = text.trim();
        onChange(text.trim());
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (instant) {
            last.current = e.target.value.trim();
            onChange(e.target.value.trim());
          }
        }}
        placeholder="Name, E-Mail oder Text"
        aria-label="Rückmeldungen durchsuchen"
        className={cn(
          CONTROL,
          "elev-inset w-full border-0 bg-[var(--well)] pl-9 pr-3 text-[15px] text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        )}
      />
    </form>
  );
}

/**
 * The star bands as a menu (Nicereply's score filter, the reply templates'
 * bands). The trigger holds every label in one cell, so it keeps the width
 * of the longest whichever band is set.
 */
function StarFilter({
  band,
  onPick,
}: {
  band: (typeof STAR_BANDS)[number] | null;
  onPick: (b: string | null) => void;
}) {
  const labels = ["Alle Sterne", ...STAR_BANDS.map((b) => STAR_BAND_LABELS[b])];
  const current = band ? STAR_BAND_LABELS[band] : "Alle Sterne";
  const options: Array<{ value: string | null; label: string }> = [
    { value: null, label: "Alle Sterne" },
    ...STAR_BANDS.map((b) => ({ value: b, label: STAR_BAND_LABELS[b] })),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Sterne: ${current}`}
        className={cn(
          CONTROL,
          "inline-flex shrink-0 items-center gap-1.5 border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          band
            ? RAISED_CONTROL
            : "border-dashed border-[var(--border-hover)] text-fg-secondary hover:border-fg-tertiary hover:text-fg-primary"
        )}
      >
        <span aria-hidden className="inline-grid">
          {labels.map((l) => (
            <span key={l} className={cn("col-start-1 row-start-1 whitespace-nowrap", l !== current && "invisible")}>
              {l}
            </span>
          ))}
        </span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU}>
        {options.map((o, i) => (
          <div key={o.label}>
            {i === 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => onPick(o.value)}
              aria-current={o.value === band ? "true" : undefined}
              className={cn(o.value === band && "font-medium text-fg-primary")}
            >
              {o.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
