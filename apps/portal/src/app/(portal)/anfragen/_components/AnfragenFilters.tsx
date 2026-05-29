"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
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
import { Button, Input, cn } from "@eins/ui";
import { withBrandLogos } from "@/app/_components/Brand";
import {
  AI_CATEGORIES,
  AI_CATEGORY_LABELS,
  REQUEST_SOURCES,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type AiCategory,
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

  const isSetMember = (key: string, value: string) =>
    (params.get(key) ?? "").split(",").filter(Boolean).includes(value);

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
      className={cn(
        "transition-opacity",
        isPending && "opacity-70"
      )}
      aria-busy={isPending}
    >
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="relative max-w-md flex-1">
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
        {hasAnyFilter && (
          <Button asChild type="button" variant="ghost" className="h-11">
            <Link href="/anfragen">
              <X className="mr-1 h-4 w-4" />
              Filter zurücksetzen
            </Link>
          </Button>
        )}
      </div>

      <div className="divide-y divide-border/60 border-t border-border/60">
        <FilterGroup icon={CheckCircle2} label="Status">
          {STATUSES.map((s) => (
            <Chip
              key={s}
              active={isSetMember("status", s)}
              onClick={() => toggleMulti("status", s)}
            >
              {REQUEST_STATUS_LABELS[s]}
            </Chip>
          ))}
          <Chip
            tone="warn"
            active={isFlag("stale")}
            onClick={() => toggleBoolean("stale")}
          >
            Stagniert (14+ Tage)
          </Chip>
        </FilterGroup>

        <FilterGroup icon={Radio} label="Quelle">
          {REQUEST_SOURCES.map((s) => (
            <Chip
              key={s}
              active={isSetMember("source", s)}
              onClick={() => toggleMulti("source", s)}
            >
              {withBrandLogos(SOURCE_LABELS[s as RequestSource] ?? s)}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup icon={Sparkles} label="KI-Bewertung">
          {AI_CATEGORIES.map((c) => {
            const tone: ChipTone =
              c === "hot" ? "bad" : c === "warm" ? "warn" : "accent";
            const Icon = c === "hot" ? Flame : c === "warm" ? Sun : Snowflake;
            return (
              <Chip
                key={c}
                tone={tone}
                active={isSetMember("aiCategory", c)}
                onClick={() => toggleMulti("aiCategory", c)}
              >
                <Icon className="h-3 w-3" aria-hidden />
                {AI_CATEGORY_LABELS[c as AiCategory]}
                <span
                  className="-mr-1 ml-0.5 rounded-full bg-fg-primary/10 px-1.5 py-px text-[11px] font-semibold leading-none tabular-nums"
                  aria-label={`${aiCounts[c] ?? 0} Anfragen`}
                >
                  {aiCounts[c] ?? 0}
                </span>
              </Chip>
            );
          })}
        </FilterGroup>

        {treatments.length > 0 && (
          <FilterGroup icon={Tag} label="Behandlung">
            {treatments.slice(0, 8).map((t) => (
              <Chip
                key={t.id}
                active={isSetMember("treatment", t.id)}
                onClick={() => toggleMulti("treatment", t.id)}
              >
                {t.name}
              </Chip>
            ))}
          </FilterGroup>
        )}
      </div>
    </div>
  );
}

function FilterGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 md:flex-nowrap">
      <div className="flex w-full shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-tertiary md:w-32">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span>{label}</span>
      </div>
      <div className="flex flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

type ChipTone = "neutral" | "accent" | "warn" | "bad" | "good";

function Chip({
  children,
  active,
  tone = "neutral",
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  tone?: ChipTone;
  onClick: () => void;
}) {
  const activeClasses =
    tone === "bad"
      ? "border-tone-bad/45 bg-tone-bad/10 text-tone-bad"
      : tone === "warn"
        ? "border-tone-warn/45 bg-tone-warn/12 text-tone-warn"
        : tone === "good"
          ? "border-tone-good/45 bg-tone-good/10 text-tone-good"
          : tone === "accent"
            ? "border-accent bg-accent/15 text-fg-primary"
            : "border-fg-primary/35 bg-bg-secondary text-fg-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary",
        active
          ? activeClasses
          : "border-border text-fg-secondary hover:border-border-hover hover:bg-bg-secondary"
      )}
    >
      {children}
    </button>
  );
}
