"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileText, List, Search, X } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@eins/ui";
import { fold } from "@/lib/search/match";
import { setSearchParams } from "@/app/_components/instant-views";
import {
  CONTROL,
  CONTROL_SQUARE,
  DashCard,
  RAISED_CONTROL,
  TABLE_HEAD_BAND,
  WASH_AREA,
  WASH_ROW,
} from "../../dashboard/_components/dash-ui";
import { COLUMNS, GROUP_GAP, PDF_WIDTH, ROW, SECTION_SCROLL, STACK } from "../_lib/sizes";
import { cardsOf } from "../_lib/cards";
import type { Group, Item, Section } from "../_lib/sections";
import { ItemBody, LeitfadenContext, WarningMark, useLeitfaden, type Labels } from "./blocks";

export const PDF_HREF = "/dateien?kind=vertriebsleitfaden";

/** The page's one action: the full playbook, on Dateien. */
export function PdfButton({ label, className }: { label: string; className?: string }) {
  return (
    <Button asChild variant="outline" className={cn(RAISED_CONTROL, CONTROL, PDF_WIDTH, "shrink-0 px-3.5", className)}>
      <Link href={PDF_HREF}>
        <FileText className="h-4 w-4" aria-hidden />
        {label}
      </Link>
    </Button>
  );
}

/**
 * The Leitfaden for the call: five cards of rows in one reading column, a
 * search over every row and the sections to jump to.
 *
 * - Search (Help Scout's saved replies): filters in the browser as you type,
 *   umlauts folded like the FAQ; matching rows open, groups and cards
 *   without a match drop out. It lives in `?suche=` (`setSearchParams`, no
 *   request), so a reload or a shared link opens the same view.
 * - Sections: from xl a rail "Auf dieser Seite" (Vercel's docs), below xl a
 *   square list button with the same entries as a menu (Stripe's docs). Both
 *   are plain anchors and mark the section in view.
 * - Rows (GOV.UK's accordion): a tap opens the row in place and pushes the
 *   rows below, like a docs page. A reading list of one column, so nothing
 *   beside it changes size (DESIGN.md section 10).
 */
export function LeitfadenView({
  sections,
  labels,
  praxisName,
  initialQuery,
}: {
  sections: Section[];
  labels: Labels;
  praxisName: string | null;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const term = fold(query.trim());

  // The address follows the field, a moment after the last key.
  useEffect(() => {
    const t = window.setTimeout(() => setSearchParams({ suche: query.trim() || null }), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const shown = useMemo(() => filterSections(sections, term), [sections, term]);

  // Rows opened by tap. While searching every hit is open, and a tap closes
  // it for this search only.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [closedInSearch, setClosedInSearch] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => setClosedInSearch(new Set()), [term]);
  const isOpen = (id: string) => (term ? !closedInSearch.has(id) : opened.has(id));
  const toggle = (id: string) => (term ? setClosedInSearch : setOpened)((s) => flip(s, id));

  const active = useActiveSection(shown.map((s) => s.id));

  return (
    <LeitfadenContext.Provider value={{ labels, praxisName }}>
      <div className={STACK}>
        {/* First row from md (the title is for screen readers there, like
            Anfragen): search, the section menu below xl, the PDF at the end.
            On the phone a band under the header that stays while scrolling
            (the Übersicht's period band), the PDF in the title row above. */}
        <div className="sticky top-14 z-30 -mx-4 -my-2 flex items-center gap-2 bg-[color-mix(in_srgb,var(--surface-canvas)_82%,transparent)] px-4 py-2 backdrop-blur-md md:static md:m-0 md:min-h-[var(--shell-row)] md:bg-transparent md:p-0 md:backdrop-blur-none">
          <SearchField value={query} onChange={setQuery} />
          <SectionMenu sections={shown} active={active} className="xl:hidden" />
          <PdfButton label={labels.pdf} className="hidden md:ml-auto md:inline-flex" />
        </div>

        <div className={COLUMNS}>
          <div className={STACK}>
            {shown.length === 0 ? (
              <DashCard bodyClassName="pt-5 md:pt-6">
                <p className="text-[15px] leading-6 text-fg-primary">
                  {labels.searchEmpty.replace("{suche}", query.trim())}
                </p>
              </DashCard>
            ) : (
              shown.flatMap(cardsOf).map((c) => (
                <DashCard key={c.key} id={c.id} title={c.title} className={SECTION_SCROLL}>
                  {c.groups.map((g, i) => (
                    <GroupView key={g.id} group={g} first={i === 0} isOpen={isOpen} toggle={toggle} />
                  ))}
                </DashCard>
              ))
            )}
          </div>
          <SectionRail sections={shown} active={active} />
        </div>
      </div>
    </LeitfadenContext.Provider>
  );
}

function flip(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function filterSections(sections: Section[], term: string): Section[] {
  if (!term) return sections;
  return sections
    .map((s) => ({
      ...s,
      groups: s.groups
        .map((g) => ({ ...g, items: g.items.filter((it) => it.haystack.includes(term)) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((s) => s.groups.length > 0);
}

/** The section in view: the last one whose top has passed the band under the header. */
function useActiveSection(ids: string[]): string | null {
  const key = ids.join(",");
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    const list = key ? key.split(",") : [];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.matchMedia("(min-width: 768px)").matches ? 96 : 148;
      let current = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // At the foot of the page the last section counts, however short.
      const doc = document.documentElement;
      if (list.length && window.scrollY + window.innerHeight >= doc.scrollHeight - 2) current = list[list.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return active;
}

/** Anfragen's search field: pressed into the canvas, X to clear. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { labels } = useLeitfaden();
  return (
    <div className="relative min-w-0 flex-1 xl:max-w-sm">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
        aria-hidden
      />
      <Input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchLabel}
        className="elev-inset h-[var(--control-h)] rounded-[var(--r-control)] border-0 bg-[var(--surface-inset)] pl-10 pr-10 text-[15px] focus:bg-[var(--surface-tile)]"
      />
      <div className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
        {value ? (
          <button
            type="button"
            aria-label={labels.searchClear}
            onClick={() => onChange("")}
            className="rounded-full p-0.5 text-fg-tertiary transition hover:bg-[var(--hover-wash)] hover:text-fg-primary"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const MENU =
  "max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[15rem] overflow-auto rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]";

/**
 * Below xl: Stripe's square list button; its menu lists the sections with
 * the one in view marked, a tap jumps there.
 */
function SectionMenu({
  sections,
  active,
  className,
}: {
  sections: Section[];
  active: string | null;
  className?: string;
}) {
  const { labels } = useLeitfaden();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={labels.toc}
        disabled={sections.length === 0}
        className={cn(
          RAISED_CONTROL,
          CONTROL,
          CONTROL_SQUARE,
          "inline-flex shrink-0 items-center justify-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
          className
        )}
      >
        <List className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={MENU}
        // Focus stays where the jump went, not back on the button.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel className="text-fg-secondary">{labels.toc}</DropdownMenuLabel>
        {sections.map((s) => (
          <DropdownMenuItem key={s.id} asChild>
            <a
              href={`#${s.id}`}
              aria-current={s.id === active ? "location" : undefined}
              className={cn(
                "flex min-h-[var(--control-h)] items-center text-[15px]",
                s.id === active ? "font-medium text-fg-primary" : "text-fg-secondary"
              )}
            >
              {s.title}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * From xl: Vercel's "On this page" rail beside the cards, level with the
 * first one. Entries on a hairline track; the section in view is dark with a
 * dark bar, the rest grey. No mint.
 */
function SectionRail({ sections, active }: { sections: Section[]; active: string | null }) {
  const { labels } = useLeitfaden();
  if (sections.length === 0) return null;
  return (
    <nav aria-label={labels.toc} className="sticky top-8 hidden xl:block">
      <p className="text-sm font-medium leading-5 text-fg-primary">{labels.toc}</p>
      <ul className="mt-3 border-l border-border">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={s.id === active ? "location" : undefined}
              className={cn(
                "-ml-px block border-l-2 py-1.5 pl-3 text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                s.id === active
                  ? "border-fg-primary font-medium text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary"
              )}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function GroupView({
  group,
  first,
  isOpen,
  toggle,
}: {
  group: Group;
  first: boolean;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  const { labels } = useLeitfaden();
  return (
    <div className={cn(!first && GROUP_GAP)}>
      {/* Linear's group header, pressed into the card. */}
      {group.label && (
        <h3 className={cn(TABLE_HEAD_BAND, "flex items-center px-3 font-medium")}>{group.label}</h3>
      )}
      {/* GOV.UK's warning text: the mark and the rule in bold, always open. */}
      {group.warning && (
        <p className="flex gap-3 border-b border-border py-3 text-[15px] font-semibold leading-6 text-fg-primary">
          <WarningMark />
          <span>
            <span className="sr-only">{labels.warning}: </span>
            {group.warning}
          </span>
        </p>
      )}
      <ul className="divide-y divide-border">
        {group.items.map((it) => (
          <Row key={it.id} item={it} heading={group.label ? "h4" : "h3"} open={isOpen(it.id)} onToggle={() => toggle(it.id)} />
        ))}
      </ul>
    </div>
  );
}

function Row({
  item,
  heading: Heading,
  open,
  onToggle,
}: {
  item: Item;
  heading: "h3" | "h4";
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `${item.id}-text`;
  return (
    // 4 px white inside the hairlines, the wash 12 px past the title (DESIGN.md section 5).
    <li className={WASH_ROW}>
      <Heading>
        <button
          type="button"
          id={`${item.id}-row`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-[var(--r-control)] text-left transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            WASH_AREA,
            ROW
          )}
        >
          {item.warning && <WarningMark />}
          <span className="min-w-0 flex-1 text-[15px] font-medium leading-5 text-fg-primary">{item.title}</span>
          <ChevronDown
            aria-hidden
            className={cn("h-4 w-4 shrink-0 text-fg-tertiary transition-transform", open && "rotate-180")}
          />
        </button>
      </Heading>
      {open && (
        <div id={panelId} role="region" aria-labelledby={`${item.id}-row`}>
          <ItemBody title={item.title} blocks={item.body} />
        </div>
      )}
    </li>
  );
}
