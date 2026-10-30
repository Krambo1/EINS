"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownUp,
  Check,
  CirclePlus,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@eins/ui";
import { withBrandLogos } from "@/app/_components/Brand";
import { useNavTransition } from "@/app/_components/instant-views";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { HOVER_CARD } from "../../dashboard/_components/hover-card";
import {
  ALL_REQUEST_STATUSES,
  ALL_REQUEST_STATUS_LABELS,
  REQUEST_SORTS,
  REQUEST_SORT_LABELS,
  type RequestSort,
} from "@/lib/constants";
import { reportingChannelLabel, type ReportingChannel } from "@/lib/sources";

/**
 * The Quelle filter: the channels the Quellen card counts, in groups (the
 * Praxis's own posts first, then bezahlte Anzeigen, then everything else).
 */
const CHANNEL_GROUPS: readonly (readonly ReportingChannel[])[] = [
  ["instagram_organisch", "facebook_organisch", "tiktok_organisch", "profil_link", "dm_link"],
  ["meta_anzeige", "google_anzeige"],
  ["empfehlung", "whatsapp", "manuell", "pvs_import", "direkt", "unbekannt"],
];

interface Props {
  treatments: { id: string; name: string }[];
  /** "Anfrage anlegen" at the end of the row (from md; the phone has it in the title row). */
  canCreate?: boolean;
}

/**
 * Where the parts of the row sit. Phone: the search field and the sort icon,
 * the chips below. md to xl: the search field, the sort icon and "Anfrage
 * anlegen" in the first row, the chips in the second. From xl one row: the
 * search field and the chips on the left, the sort and "Anfrage anlegen" at
 * the right end (the toolbar of Attio's and Notion's tables); the sort shows
 * its label from 1400 px.
 */
const SEARCH_SLOT =
  "relative min-w-0 grow basis-[calc(100%-var(--control-h)-0.5rem)] xl:mr-2 xl:w-72 xl:min-w-48 xl:shrink xl:grow-0 xl:basis-auto";
/** With "Anfrage anlegen" (10 rem) in the first row from md. */
const SEARCH_SLOT_WITH_ACTION = "md:basis-[calc(100%-var(--control-h)-11rem)]";
const SORT_SLOT = "w-[var(--control-h)] xl:order-1 xl:ml-auto min-[1400px]:w-auto min-[1400px]:px-3";
const ACTION_SLOT = "hidden w-40 shrink-0 md:inline-flex xl:order-2";

// Every status incl. the PVS-set "Nicht erschienen" / "Behandelt" (C-29).
const STATUSES = ALL_REQUEST_STATUSES;

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Menus float like the hover cards: a hairline and a soft drop. Panel radius,
 * and the entries 4 px inside it one step smaller, so their corners share a
 * centre (DESIGN.md section 5, "Radius by size"). Full height where the
 * screen allows it; scrolls only when it has to.
 */
const MENU =
  "max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[13rem] overflow-auto rounded-[var(--r-panel)] border border-border elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]";

export function AnfragenFilters({ treatments, canCreate = false }: Props) {
  // Inside the page's NavTransition: every control shows its new value on the
  // tap (the target address), the rows dim until the server render lands, and
  // this bar itself never dims or shows a spinner (DESIGN.md section 10).
  const nav = useNavTransition();
  if (!nav) throw new Error("AnfragenFilters gehört in eine NavTransition");
  const params = nav.params;

  const urlSearch = params.get("search") ?? "";
  const [searchText, setSearchText] = useState(urlSearch);

  // Track the last value we pushed into the URL so we can distinguish
  // input-driven changes (debounce → navigate) from external URL changes
  // (Zurücksetzen, back nav). Without this, the sync effect would race
  // the debounce effect.
  const lastPushedRef = useRef(urlSearch);

  useEffect(() => {
    if (urlSearch !== lastPushedRef.current) {
      lastPushedRef.current = urlSearch;
      setSearchText(urlSearch);
    }
  }, [urlSearch]);

  const navigateRef = useRef(nav.navigate);
  navigateRef.current = nav.navigate;

  useEffect(() => {
    if (searchText === urlSearch) return;
    const handle = setTimeout(() => {
      lastPushedRef.current = searchText;
      navigateRef.current((next) => {
        if (searchText) next.set("search", searchText);
        else next.delete("search");
        next.delete("page");
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchText, urlSearch]);

  const navigate = (nextParams: URLSearchParams) => {
    nextParams.delete("page");
    nav.navigate((p) => {
      for (const key of Array.from(p.keys())) p.delete(key);
      nextParams.forEach((v, k) => p.append(k, v));
    });
  };

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    const current = (next.get(key) ?? "").split(",").filter(Boolean);
    const after = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    if (after.length === 0) next.delete(key);
    else next.set(key, after.join(","));
    navigate(next);
  };

  const toggleBoolean = (key: string) => {
    const next = new URLSearchParams(params.toString());
    if (next.get(key) === "1") next.delete(key);
    else next.set(key, "1");
    navigate(next);
  };

  // Sort is single-select, not a filter: "neueste" is the default and drops
  // the param entirely so the canonical /anfragen URL stays clean.
  const sortParam = params.get("sort");
  const currentSort: RequestSort = (REQUEST_SORTS as readonly string[]).includes(
    sortParam ?? ""
  )
    ? (sortParam as RequestSort)
    : "neueste";
  const setSort = (value: RequestSort) => {
    const next = new URLSearchParams(params.toString());
    if (value === "neueste") next.delete("sort");
    else next.set("sort", value);
    navigate(next);
  };

  const isSetMember = (key: string, value: string) =>
    (params.get(key) ?? "").split(",").filter(Boolean).includes(value);

  const isFlag = (key: string) => params.get(key) === "1";

  /** What a set filter shows on its chip: its one value, or how many. */
  const summary = (
    key: string,
    labelOf: (v: string) => string,
    extra: (string | false)[] = []
  ): Picked | undefined => {
    const set = (params.get(key) ?? "").split(",").filter(Boolean);
    const values = [...set.map(labelOf), ...extra.filter((e): e is string => !!e)];
    if (values.length === 0) return undefined;
    return { count: values.length, text: values.join(", ") };
  };

  // Stripe's list toolbar: the search field pressed into the canvas, one chip
  // per filter (dashed while empty, raised with its value once set), the
  // sort order and the page's one action at the end of the row. It is the
  // page's first row from md, like the period switch on the Übersicht. Every
  // control is one height (--control-h). Each breakpoint has one layout in
  // every state (SEARCH_SLOT above), and "Filter zurücksetzen" sits in the
  // list card's header, so setting a filter never wraps the row (DESIGN.md
  // section 10, "Fixed size").
  return (
    <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
      <div className={cn(SEARCH_SLOT, canCreate && SEARCH_SLOT_WITH_ACTION)}>
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
          aria-hidden
        />
        <Input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Suchen: Name, Telefon, E-Mail"
          className="elev-inset h-[var(--control-h)] rounded-[var(--r-control)] border-0 bg-[var(--surface-inset)] pl-10 pr-10 text-[15px] focus:bg-[var(--surface-tile)]"
          aria-label="Anfragen durchsuchen"
        />
        <div className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
          {searchText ? (
            <button
              type="button"
              aria-label="Suche zurücksetzen"
              onClick={() => setSearchText("")}
              className="rounded-full p-0.5 text-fg-tertiary transition hover:bg-[var(--hover-wash)] hover:text-fg-primary"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Sort is not a filter but always has a value, so it stands raised
          like a set chip (Linear's "Display" control). An icon beside the
          search field, at the end of the row from xl, with its label from
          1400 px. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Sortierung: ${REQUEST_SORT_LABELS[currentSort]}`}
          className={cn(
            RAISED_CONTROL,
            "inline-flex h-[var(--control-h)] shrink-0 items-center justify-center gap-1.5 rounded-[var(--r-control)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            SORT_SLOT
          )}
        >
          <ArrowDownUp className="h-4 w-4 shrink-0" aria-hidden />
          {/* Every label in one grid cell, only the current one visible: the
              button is as wide as the longest label whatever is picked, so
              its edge does not move (DESIGN.md section 10, "Fixed size"). */}
          <span className="hidden min-[1400px]:inline-grid">
            {REQUEST_SORTS.map((s) => (
              <span
                key={s}
                aria-hidden
                className={cn("col-start-1 row-start-1 whitespace-nowrap text-left", s !== currentSort && "invisible")}
              >
                {REQUEST_SORT_LABELS[s]}
              </span>
            ))}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={MENU}>
          {REQUEST_SORTS.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => setSort(s)}
              className="justify-between gap-6"
            >
              {REQUEST_SORT_LABELS[s]}
              {currentSort === s && (
                <Check className="h-4 w-4 shrink-0 text-fg-primary" aria-hidden />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {canCreate && (
        <Button asChild size="sm" className={cn(CONTROL, ACTION_SLOT, "px-4")}>
          <Link href="/anfragen/neu">
            <UserPlus className="h-4 w-4" aria-hidden />
            Anfrage anlegen
          </Link>
        </Button>
      )}

      <FilterDropdown
        label="Status"
        picked={summary(
          "status",
          (v) => ALL_REQUEST_STATUS_LABELS[v as keyof typeof ALL_REQUEST_STATUS_LABELS] ?? v,
          [
            isFlag("stale") && "Stagniert",
            isSetMember("wb", "offen") && "Wiederbehandlung",
            isSetMember("wb", "ausgeblendet") && "Wiederbehandlung ausgeblendet",
          ]
        )}
      >
        {STATUSES.map((s) => (
          <DropdownMenuCheckboxItem
            key={s}
            checked={isSetMember("status", s)}
            onCheckedChange={() => toggleMulti("status", s)}
            onSelect={(e) => e.preventDefault()}
          >
            {ALL_REQUEST_STATUS_LABELS[s]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={isFlag("stale")}
          onCheckedChange={() => toggleBoolean("stale")}
          onSelect={(e) => e.preventDefault()}
        >
          Stagniert (14+ Tage)
        </DropdownMenuCheckboxItem>
        {/* Everyone the old Wiederbehandlungen card listed, and everyone it
            hid, as filters of this list (Karam, 2026-10-29); the rows show
            the Wiederbehandlung as their status. */}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={isSetMember("wb", "offen")}
          onCheckedChange={() => toggleMulti("wb", "offen")}
          onSelect={(e) => e.preventDefault()}
        >
          Wiederbehandlung fällig oder bald
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={isSetMember("wb", "ausgeblendet")}
          onCheckedChange={() => toggleMulti("wb", "ausgeblendet")}
          onSelect={(e) => e.preventDefault()}
        >
          Wiederbehandlung ausgeblendet
        </DropdownMenuCheckboxItem>
      </FilterDropdown>

      <FilterDropdown
        label="Quelle"
        picked={summary("source", reportingChannelLabel)}
      >
        {CHANNEL_GROUPS.map((group, i) => (
          <Fragment key={group[0]}>
            {i > 0 && <DropdownMenuSeparator />}
            {group.map((c) => (
              <DropdownMenuCheckboxItem
                key={c}
                checked={isSetMember("source", c)}
                onCheckedChange={() => toggleMulti("source", c)}
                onSelect={(e) => e.preventDefault()}
              >
                {withBrandLogos(reportingChannelLabel(c))}
              </DropdownMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
      </FilterDropdown>

      {treatments.length > 0 && (
        <FilterDropdown
          label="Behandlung"
          picked={summary(
            "treatment",
            (id) => treatments.find((t) => t.id === id)?.name ?? "1 ausgewählt"
          )}
        >
          {treatments.slice(0, 8).map((t) => (
            <DropdownMenuCheckboxItem
              key={t.id}
              checked={isSetMember("treatment", t.id)}
              onCheckedChange={() => toggleMulti("treatment", t.id)}
              onSelect={(e) => e.preventDefault()}
            >
              {t.name}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterDropdown>
      )}

    </div>
  );
}

/** Same footprint as the toolbar while the treatments load. */
export function AnfragenFiltersSkeleton({ canCreate = false }: { canCreate?: boolean }) {
  return (
    <div aria-hidden className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
      <div
        className={cn(
          "elev-inset h-[var(--control-h)] rounded-[var(--r-control)] bg-[var(--surface-inset)]",
          SEARCH_SLOT,
          canCreate && SEARCH_SLOT_WITH_ACTION
        )}
      />
      <div className="elev-raised h-[var(--control-h)] w-[var(--control-h)] shrink-0 rounded-[var(--r-control)] bg-[var(--surface-raised)] xl:order-1 xl:ml-auto min-[1400px]:w-[12.625rem]" />
      {canCreate && (
        <div className={cn("h-[var(--control-h)] animate-pulse rounded-[var(--r-control)] bg-[var(--surface-inset)]", ACTION_SLOT)} />
      )}
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[var(--control-h)] w-24 shrink-0 rounded-[var(--r-control)] border border-dashed border-[var(--border-hover)]" />
      ))}
    </div>
  );
}

/** What a filter chip has picked: how many values, and all of them as text. */
type Picked = { count: number; text: string };

/**
 * One filter as a chip that opens its menu (Stripe's filter chips). Empty:
 * dashed outline with a plus. Set: raised like the marked period, and the
 * plus becomes the number of values picked, in the same slot. The chip keeps
 * its width either way, so the chips beside it never move (DESIGN.md
 * section 10, "Fixed size"). The picked values float in a hover card and
 * are in the menu with a check.
 */
function FilterDropdown({
  label,
  picked,
  children,
}: {
  label: string;
  /** Set once the filter has values; undefined while it is empty. */
  picked?: Picked;
  children: React.ReactNode;
}) {
  const isActive = picked != null;

  return (
    <DropdownMenu>
      {/*
        No `asChild` + inner <button>: DropdownMenuTrigger already renders its
        own <button> (incl. a hydration-safe SSR placeholder). Nesting a button
        inside it produces invalid <button><button> markup that the HTML parser
        splits into siblings, leaving a detached, unclickable trigger. Style the
        Trigger directly instead.
      */}
      <DropdownMenuTrigger
        aria-label={isActive ? `${label}: ${picked.text}` : `${label} filtern`}
        className={cn(
          "group/chip relative inline-flex h-[var(--control-h)] shrink-0 items-center gap-1.5 rounded-[var(--r-control)] border px-3 text-sm font-medium transition-[color,border-color,box-shadow,background-color]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          isActive
            ? RAISED_CONTROL
            : "border-dashed border-[var(--border-hover)] text-fg-secondary hover:border-fg-tertiary hover:text-fg-primary"
        )}
      >
        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
          {isActive ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-fg-primary text-[11px] font-semibold tabular-nums leading-none text-[var(--surface-tile)]">
              {picked.count}
            </span>
          ) : (
            <CirclePlus className="h-4 w-4" />
          )}
        </span>
        <span aria-hidden className="whitespace-nowrap">
          {label}
        </span>
        {isActive && (
          // The picked values, like the hover cards on the Übersicht; not
          // while the menu is open, which lists them anyway.
          <span
            aria-hidden
            className={cn(
              HOVER_CARD,
              "bottom-auto left-0 top-full mb-0 mt-2 hidden w-max max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal text-left font-normal group-hover/chip:group-data-[state=closed]/chip:block"
            )}
          >
            <span className="block text-sm font-semibold leading-5 text-fg-primary">{label}</span>
            <span className="mt-1 block text-sm leading-5 text-fg-primary">{picked.text}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={MENU}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
