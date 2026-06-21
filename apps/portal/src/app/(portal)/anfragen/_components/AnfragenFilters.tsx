"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownWideNarrow,
  Check,
  CheckCircle2,
  ChevronDown,
  Flame,
  Loader2,
  Radio,
  Search,
  Snowflake,
  Sparkles,
  Sun,
  Tag,
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
import {
  AI_CATEGORIES,
  AI_CATEGORY_LABELS,
  REQUEST_SORTS,
  REQUEST_SORT_LABELS,
  REQUEST_SOURCES,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type AiCategory,
  type RequestSort,
  type RequestSource,
  type RequestStatus,
} from "@/lib/constants";

interface Props {
  treatments: { id: string; name: string }[];
  /** Clinic-wide count per KI-Kategorie (hot/warm/cold) for the count pills. */
  aiCounts: Record<string, number>;
}

const STATUSES: RequestStatus[] = [
  "neu",
  "kontaktiert",
  "nicht_erreicht",
  "termin_vereinbart",
  "beratung_erschienen",
  "gewonnen",
  "verloren",
];

const SEARCH_DEBOUNCE_MS = 200;

export function AnfragenFilters({ treatments, aiCounts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlSearch = params.get("search") ?? "";
  const [searchText, setSearchText] = useState(urlSearch);

  // Track the last value we pushed into the URL so we can distinguish
  // input-driven changes (debounce → replace) from external URL changes
  // (Zurücksetzen, back nav). Without this, the sync effect would race
  // the debounce effect.
  const lastPushedRef = useRef(urlSearch);

  useEffect(() => {
    if (urlSearch !== lastPushedRef.current) {
      lastPushedRef.current = urlSearch;
      setSearchText(urlSearch);
    }
  }, [urlSearch]);

  useEffect(() => {
    if (searchText === urlSearch) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (searchText) next.set("search", searchText);
      else next.delete("search");
      next.delete("page");
      lastPushedRef.current = searchText;
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchText, urlSearch, params, pathname, router]);

  const navigate = (nextParams: URLSearchParams) => {
    nextParams.delete("page");
    const qs = nextParams.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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

  const countSet = (key: string) =>
    (params.get(key) ?? "").split(",").filter(Boolean).length;

  const isFlag = (key: string) => params.get(key) === "1";

  const hasAnyFilter = Boolean(
    params.get("search") ||
      params.get("status") ||
      params.get("source") ||
      params.get("aiCategory") ||
      params.get("treatment") ||
      params.get("slaBreached") ||
      params.get("stale")
  );

  return (
    <div
      data-tour="anfragen-filters"
      className={cn("transition-opacity", isPending && "opacity-70")}
      aria-busy={isPending}
    >
      <div className="relative mb-3 max-w-md">
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
          placeholder="Suchen: Name, E-Mail, Telefon, Wunschbehandlung …"
          className="h-11 pl-10 pr-10"
          aria-label="Anfragen durchsuchen"
        />
        <div className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-fg-tertiary" aria-hidden />
          ) : searchText ? (
            <button
              type="button"
              aria-label="Suche zurücksetzen"
              onClick={() => setSearchText("")}
              className="rounded-full p-0.5 text-fg-tertiary transition hover:bg-bg-secondary hover:text-fg-primary"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          icon={ArrowDownWideNarrow}
          label="Sortierung"
          summaryText={REQUEST_SORT_LABELS[currentSort]}
          active={currentSort !== "neueste"}
        >
          {REQUEST_SORTS.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => setSort(s)}
              className="justify-between gap-6"
            >
              {REQUEST_SORT_LABELS[s]}
              {currentSort === s && (
                <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              )}
            </DropdownMenuItem>
          ))}
        </FilterDropdown>

        <FilterDropdown
          icon={CheckCircle2}
          label="Status"
          activeCount={countSet("status") + (isFlag("stale") ? 1 : 0)}
        >
          {STATUSES.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={isSetMember("status", s)}
              onCheckedChange={() => toggleMulti("status", s)}
              onSelect={(e) => e.preventDefault()}
            >
              {REQUEST_STATUS_LABELS[s]}
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
        </FilterDropdown>

        <FilterDropdown icon={Radio} label="Quelle" activeCount={countSet("source")}>
          {REQUEST_SOURCES.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={isSetMember("source", s)}
              onCheckedChange={() => toggleMulti("source", s)}
              onSelect={(e) => e.preventDefault()}
            >
              {withBrandLogos(SOURCE_LABELS[s as RequestSource] ?? s)}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterDropdown>

        <FilterDropdown
          icon={Sparkles}
          label="KI-Bewertung"
          activeCount={countSet("aiCategory")}
          dataTour="anfragen-ki"
        >
          {AI_CATEGORIES.map((c) => {
            const Icon = c === "hot" ? Flame : c === "warm" ? Sun : Snowflake;
            const tone =
              c === "hot"
                ? "text-tone-bad"
                : c === "warm"
                  ? "text-tone-warn"
                  : "text-accent";
            return (
              <DropdownMenuCheckboxItem
                key={c}
                checked={isSetMember("aiCategory", c)}
                onCheckedChange={() => toggleMulti("aiCategory", c)}
                onSelect={(e) => e.preventDefault()}
              >
                <Icon className={cn("mr-2 h-3.5 w-3.5 shrink-0", tone)} aria-hidden />
                <span>{AI_CATEGORY_LABELS[c as AiCategory]}</span>
                <span
                  className="ml-auto rounded-full bg-fg-primary/10 px-1.5 py-px text-[11px] font-semibold leading-none tabular-nums"
                  aria-label={`${aiCounts[c] ?? 0} Anfragen`}
                >
                  {aiCounts[c] ?? 0}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </FilterDropdown>

        {treatments.length > 0 && (
          <FilterDropdown
            icon={Tag}
            label="Behandlung"
            activeCount={countSet("treatment")}
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

        {hasAnyFilter && (
          <Button asChild type="button" variant="ghost" className="h-10">
            <Link href="/anfragen">
              <X className="mr-1 h-4 w-4" />
              Filter zurücksetzen
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One filter category rendered as a dropdown-menu pill. All five sit in a
 * single wrapping row (was five stacked chip rows). The trigger shows the
 * category label plus a `· N` suffix for active multi-selects, or `· value`
 * for the single-select sort. Mirrors the admin-side AdminUrlMultiSelect.
 */
function FilterDropdown({
  icon: Icon,
  label,
  activeCount = 0,
  summaryText,
  active,
  dataTour,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  /** Number of active selections, shown as a `· N` suffix on the trigger. */
  activeCount?: number;
  /** Free-text suffix shown on the trigger (used for single-select sort). */
  summaryText?: string;
  /** Force the active/highlighted trigger style (sort uses this; multi derives it). */
  active?: boolean;
  /** Optional `data-tour` anchor on the trigger pill (product-tour spotlight). */
  dataTour?: string;
  children: React.ReactNode;
}) {
  const isActive = active ?? activeCount > 0;

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
        data-tour={dataTour}
        className={cn(
          "inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          isActive
            ? "border-accent bg-bg-secondary text-fg-primary"
            : "border-border text-fg-secondary hover:border-accent hover:text-fg-primary"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">
          {label}
          {summaryText
            ? ` · ${summaryText}`
            : activeCount > 0
              ? ` · ${activeCount}`
              : ""}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 min-w-[13rem] overflow-auto"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
