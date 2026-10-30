import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { ScrollHint } from "@/app/_components/ScrollHint";

/**
 * Fixed sizes of the Inhalte cards (DESIGN.md section 10, "Fixed size"), one
 * height per breakpoint, shared with the skeleton. Measured with
 * tools/fixed-size-inhalte.cjs: the next post, an opened row, a filter, the
 * last page, an empty list and a saved decision all leave them as they are.
 */
// Freigabe: 3rem more since its details have hairlines between the rows
// (Karam, 2026-10-30), so the text well keeps its height.
export const FREIGABE_CARD_HEIGHT = "h-[59.5rem] sm:h-[58.5rem] lg:h-[42rem]";
// Rows with the post's picture (72 px) and the header with "Alle
// herunterladen" (a control, 24 px phone / 20 px sm+ taller than a title
// line) since the Medien card became part of it (Karam, 2026-10-30).
export const POSTS_CARD_HEIGHT = "h-[53.625rem] sm:h-[52.875rem] lg:h-[53.875rem]";

/** "Zur Freigabe": the preview frame (from lg a column the card's height) and the title block (two lines, a longer title scrolls). */
export const PREVIEW_FRAME = "h-[15rem] w-full shrink-0 lg:h-auto lg:w-[16.5rem]";
export const TITLE_BLOCK = "flex h-14 shrink-0 overflow-y-auto";
/**
 * A details list (`<dl>` of `Detail`) with a hairline above, below and
 * between the rows, label column left (Stripe's details panel).
 */
export const DETAIL_LINES =
  "grid grid-cols-[7.5rem_minmax(0,1fr)] border-y border-border [&>dd]:border-b [&>dd]:border-border [&>dd]:py-2 [&>dt]:border-b [&>dt]:border-border [&>dt]:py-2 [&>dt]:pr-4 [&>:nth-last-child(-n+2)]:border-b-0";

/** Rows per page of the list; the pages stay at the foot of the card. */
export const PAGE_SIZE = 6;
/** One post row: the 48 px picture, beside two lines below lg and one line from lg. */
export const POST_ROW = "min-h-[4.5rem]";
/**
 * The well under an opened row and the room each list keeps for it, so
 * opening a row never resizes the card (DESIGN.md section 5, like the
 * Quellen on the Übersicht). Its text scrolls inside when longer.
 */
export const ROW_WELL = "h-[13rem] sm:h-[11rem]";
export const ROW_WELL_SPACE = "mx-2 mb-2 mt-0.5";

/**
 * The well under an opened row: its facts scroll inside, its buttons stand
 * at the foot, so they keep their place whatever the facts are and while a
 * field opens in place of them.
 */
export function RowWell({
  panelId,
  label,
  actions,
  children,
}: {
  panelId: string;
  label: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={panelId} className={ROW_WELL_SPACE}>
      <div
        role="region"
        aria-label={label}
        className={cn("elev-inset flex flex-col overflow-hidden rounded-[var(--r-panel)] bg-[var(--well)]", ROW_WELL)}
      >
        <ScrollHint className="flex min-h-0 flex-1 flex-col">
          <div
            tabIndex={0}
            className="scroll-shadows min-h-0 flex-1 px-4 py-3 text-[15px] [--scroll-bg:var(--well)] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {children}
          </div>
        </ScrollHint>
        {actions && <div className="flex shrink-0 flex-wrap gap-2 px-4 pb-3 pt-2">{actions}</div>}
      </div>
    </div>
  );
}

/** A status as a coloured dot and dark text, never a pill. */
export function StatusDot({ dot, children, className }: { dot: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-5 text-fg-primary", className)}>
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      {children}
    </span>
  );
}

/** One or two sentences in the middle of a card's free space. */
export function CenteredNote({ title, text }: { title: string; text?: string }) {
  return (
    <div className="m-auto max-w-sm px-4 text-center">
      <p className="text-[15px] font-medium leading-6 text-fg-primary">{title}</p>
      {text && <p className="mt-1 text-sm leading-5 text-fg-secondary">{text}</p>}
    </div>
  );
}

/** One label and value pair of a record's details (Attio). */
export function Detail({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <>
      <dt className={cn("text-sm leading-[inherit] text-fg-secondary", className)}>{label}</dt>
      <dd className={cn("min-w-0 break-words text-fg-primary", className)}>{children}</dd>
    </>
  );
}

/** A meta line under a row's name: parts joined by a middle dot. */
export function MetaLine({ children, className }: { children: ReactNode[]; className?: string }) {
  const parts = children.filter((c) => c != null && c !== false && c !== "");
  return (
    <span className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-5 text-fg-secondary", className)}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

/**
 * Pages at the foot of a list (Stripe's table footer): both buttons on every
 * page, greyed out at the ends, so neither moves.
 */
export function Pager({
  page,
  pages,
  onPage,
  label,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-2 mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-border px-2 pt-3">
      <span className="text-sm tabular-nums text-fg-secondary">
        Seite {page} von {pages}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={cn(RAISED_CONTROL, CONTROL)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Zurück
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className={cn(RAISED_CONTROL, CONTROL)}
        >
          Weiter
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** Rewrites one search param without a navigation (Next keeps useSearchParams in sync). */
export function replaceParam(name: string, value: string | null, hash?: string) {
  const url = new URL(window.location.href);
  if (value == null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  if (hash !== undefined) url.hash = hash;
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
