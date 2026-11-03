/**
 * Sizes of the three onboarding pages (Erste Schritte, Fragebogen,
 * Checkliste), shared with their `loading.tsx` so a skeleton and its page
 * always match (DESIGN.md section 10, "Fixed size"). One width and one
 * rhythm for all three.
 */
import { cn } from "@eins/ui";
import { WASH_AREA } from "../../dashboard/_components/dash-ui";

/** One width for the three pages: a list and a form read in one column. */
export const ONBOARDING_PAGE = "w-full max-w-5xl space-y-4 md:space-y-6";

/**
 * A row of the hub: title and one meta line, 12 px above and below (68 px),
 * the chevron or the one button at the end (GOV.UK's task list, Shopify's
 * setup guide). The whole row is the link. Every meta text stays under 30
 * characters, so the row never grows. Its wash reaches 12 px past the text
 * (`WASH_AREA`, DESIGN.md section 5); the `li` around it is `WASH_ROW`.
 */
export const STEP_ROW = cn(
  "flex min-h-[4.25rem] items-center gap-3 rounded-[var(--r-panel)] py-3 text-left transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
  WASH_AREA
);

/** The list of a card: hairlines between the rows, 4 px white inside them (`WASH_ROW` on each `li`). */
export const ROW_LIST = "divide-y divide-border";

/** Body of a card that is only a list: as much room above and below the rows as beside them. */
export const LIST_BODY = "py-3 md:py-4";
/** Body of a titled card that is only a list. */
export const TITLED_LIST_BODY = "pb-3 pt-2 md:pb-4";

/**
 * The hub's one line above the rows while the portal is still locked: two
 * lines below lg (beside the sidebar at md the column is as narrow as a
 * phone's), one from lg. Its text fits two lines from a 360 px phone up.
 * The skeleton draws the same box.
 */
export const GATE_LINE = "min-h-16 pb-3 pt-1 text-[15px] leading-6 text-fg-primary lg:min-h-10";

/**
 * Fragebogen and Checkliste: from xl the cards and the section rail side by
 * side (Leitfaden's "Auf dieser Seite", Vercel's docs).
 */
export const COLUMNS = "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:items-start xl:gap-12";

/** Where a jump to a section or a question stops: under the phone header, from md 32 px down. */
export const JUMP_SCROLL = "scroll-mt-[4.5rem] md:scroll-mt-8";

/** The questions of a section: room between them, no hairlines (Stripe's hosted onboarding). */
export const QUESTION_STACK = "space-y-6 md:space-y-7";

/**
 * One option of a choice (GOV.UK's radios and checkboxes): the browser's own
 * circle or box in the text colour, the whole line a target of one control
 * height. A long option wraps; its height never changes with the choice.
 * The hover wash keeps 12 px around the text, two lines or one (DESIGN.md
 * section 5).
 */
export const OPTION_ROW = cn(
  "flex min-h-[var(--control-h)] cursor-pointer items-center gap-3 rounded-[var(--r-control)] py-3 text-[15px] leading-5 text-fg-primary transition-colors hover:bg-[var(--hover-wash)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
  WASH_AREA
);
export const OPTION_INPUT = "h-5 w-5 shrink-0 cursor-pointer accent-fg-primary disabled:cursor-not-allowed";

/** A textarea: four lines, then it scrolls (with `ScrollHint`). */
export const TEXTAREA_HEIGHT = "h-[7.25rem] resize-none py-2.5 leading-6";

/**
 * The Fragebogen's submit row (GOV.UK's check answers send block): what is
 * left, then the two buttons under it, the primary first. The text has the
 * card's whole width at every size, so "Noch 17 Pflichtfragen offen · Zur
 * ersten" never wraps (beside the rail at xl the column is only 688 px).
 */
export const SUBMIT_ROW = "flex flex-col gap-4";
export const SUBMIT_BUTTONS = "flex flex-col gap-2 sm:flex-row";

/**
 * A Checkliste item (Shopify's setup guide rows, GOV.UK's task list): the
 * title, then one meta line, the chevron at the end; the whole row opens the
 * item. Below lg the title has room for two lines (88 px; beside the sidebar
 * at md the column is narrow), from lg one (68 px), so every row of a list
 * has one height whatever its title. Grey while hovered or open, 12 px past
 * the text (DESIGN.md section 5).
 */
export const ITEM_ROW = cn(
  // A button does not stretch: as wide as the list plus the 12 px each side.
  "flex min-h-[5.5rem] w-[calc(100%+1.5rem)] items-center gap-3 rounded-[var(--r-panel)] py-3 text-left transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent aria-expanded:bg-[var(--hover-wash)] lg:min-h-[4.25rem]",
  WASH_AREA
);
export const ITEM_TITLE = "line-clamp-2 text-[15px] font-medium leading-5 text-fg-primary lg:line-clamp-1";

/**
 * An opened item under its row: the Anleitung in a well (Shopify's open
 * step), 4 px white between the row's grey and the well's, then the
 * controls on white (a field in a well would be grey on grey).
 */
export const ITEM_PANEL = "pb-4 pt-1";
export const ITEM_WELL = cn("elev-inset rounded-[var(--r-panel)] bg-[var(--well)] py-3", WASH_AREA);

/** A field label in an opened item (Stripe's hosted onboarding). */
export const FIELD_LABEL = "block text-[15px] font-medium leading-6 text-fg-primary";

/** Placeholder bar of the skeletons. */
export const SKELETON_BAR = "animate-pulse rounded-[var(--r-small)] bg-[var(--well)]";
