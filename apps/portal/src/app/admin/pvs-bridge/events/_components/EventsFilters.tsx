"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, cn } from "@eins/ui";
import { X } from "lucide-react";
import { PendingLink, useNavTransition } from "@/app/_components/instant-views";

interface ClinicOption {
  id: string;
  label: string;
}

interface AppliedFilters {
  clinicId: string;
  bridgeSource: string;
  kind: string;
  range: string;
  from: string;
  to: string;
}

interface Props {
  clinics: ClinicOption[];
  bridgeSources: string[];
  eventKinds: string[];
  applied: AppliedFilters;
}

const RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "1h", label: "Letzte Stunde" },
  { value: "24h", label: "Letzte 24h" },
  { value: "7d", label: "Letzte 7 Tage" },
  { value: "custom", label: "Eigener Zeitraum" },
];

const SELECT_CLASSES =
  "h-10 w-full rounded-md border border-border bg-bg-primary px-3 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent";

export function EventsFilters({
  clinics,
  bridgeSources,
  eventKinds,
  applied: serverApplied,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [ownPending, startTransition] = useTransition();
  // Inside the page's NavTransition the selects show the new value at once
  // and the event list (not this grid) dims until the server render lands.
  const nav = useNavTransition();
  const pending = !nav && ownPending;
  const applied = nav?.pending ? appliedFrom(nav.params) : serverApplied;

  const updateParam = (key: string, value: string) => {
    const apply = (next: URLSearchParams) => {
      if (value) next.set(key, value);
      else next.delete(key);
      // Switching range presets clears the custom from/to so the server
      // doesn't keep applying a stale window.
      if (key === "range" && value !== "custom") {
        next.delete("from");
        next.delete("to");
      }
    };
    if (nav) {
      nav.navigate(apply);
      return;
    }
    const next = new URLSearchParams(params.toString());
    apply(next);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const hasAny =
    applied.clinicId ||
    applied.bridgeSource ||
    applied.kind ||
    (applied.range && applied.range !== "24h") ||
    applied.from ||
    applied.to;

  return (
    <div
      className={cn(
        "grid gap-3 transition-opacity md:grid-cols-2 lg:grid-cols-4",
        pending && "opacity-70"
      )}
      aria-busy={pending}
    >
      <FilterCell label="Praxis">
        <select
          className={SELECT_CLASSES}
          value={applied.clinicId}
          onChange={(e) => updateParam("clinic", e.target.value)}
        >
          <option value="">Alle</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </FilterCell>

      <FilterCell label="Adapter">
        <select
          className={SELECT_CLASSES}
          value={applied.bridgeSource}
          onChange={(e) => updateParam("source", e.target.value)}
        >
          <option value="">Alle</option>
          {bridgeSources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FilterCell>

      <FilterCell label="Event-Kind">
        <select
          className={SELECT_CLASSES}
          value={applied.kind}
          onChange={(e) => updateParam("kind", e.target.value)}
        >
          <option value="">Alle</option>
          {eventKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </FilterCell>

      <FilterCell label="Zeitraum">
        <select
          className={SELECT_CLASSES}
          value={applied.range || "24h"}
          onChange={(e) => updateParam("range", e.target.value)}
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </FilterCell>

      {applied.range === "custom" && (
        <>
          <FilterCell label="Von">
            <input
              type="datetime-local"
              className={SELECT_CLASSES}
              value={toLocalInput(applied.from)}
              onChange={(e) =>
                updateParam("from", fromLocalInput(e.target.value))
              }
            />
          </FilterCell>
          <FilterCell label="Bis">
            <input
              type="datetime-local"
              className={SELECT_CLASSES}
              value={toLocalInput(applied.to)}
              onChange={(e) =>
                updateParam("to", fromLocalInput(e.target.value))
              }
            />
          </FilterCell>
        </>
      )}

      {hasAny && (
        <div className="md:col-span-2 lg:col-span-4">
          <Button asChild type="button" variant="ghost" size="sm">
            <PendingLink href={pathname}>
              <X className="mr-1 h-3.5 w-3.5" />
              Filter zurücksetzen
            </PendingLink>
          </Button>
        </div>
      )}
    </div>
  );
}

/** The filters a pending address asks for (the same keys as the URL contract). */
function appliedFrom(p: URLSearchParams): AppliedFilters {
  return {
    clinicId: p.get("clinic") ?? "",
    bridgeSource: p.get("source") ?? "",
    kind: p.get("kind") ?? "",
    range: p.get("range") ?? "",
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
  };
}

function FilterCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Convert an ISO datetime string (UTC) into the `YYYY-MM-DDTHH:mm`
 *  format `<input type="datetime-local">` expects. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inverse of `toLocalInput`: convert the input's local-time string back
 *  to an ISO string so the URL carries an unambiguous instant. */
function fromLocalInput(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}
