import { Fragment } from "react";
import { EmptyState } from "@eins/ui";
import { Activity, Clock, History, Milestone } from "lucide-react";
import { DISPLAY_TIME_ZONE, berlinDateString, formatDate } from "@/lib/formatting";
import type { TimelineEntry } from "@/server/queries/timeline";
import type { TimelineStatus } from "@/lib/constants";
import {
  currentJourneyWeek,
  effectiveStatus,
  journeyStart,
} from "./journey-status";
import { dateParts, isPhaseStep } from "./timeline-labels";

/** Entry plus the status shown to the Praxis (calendar-derived for phases). */
type ShownEntry = TimelineEntry & { shownStatus: TimelineStatus };

const MONTH_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

function groupByMonth(entries: ShownEntry[]) {
  const groups = new Map<string, { label: string; entries: ShownEntry[] }>();
  for (const e of entries) {
    const d = e.eventDate;
    // Completed entries are always dated; skip any date-less row defensively.
    if (!d) continue;
    const key = berlinDateString(d).slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, { label: MONTH_FORMATTER.format(d), entries: [] });
    }
    groups.get(key)!.entries.push(e);
  }
  return Array.from(groups.values());
}

function MetaRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary md:text-base">
      {children}
    </div>
  );
}

function MetaDot() {
  return <span aria-hidden>&middot;</span>;
}

function TimelineCard({
  entry,
  now,
}: {
  entry: ShownEntry;
  now: Date;
}) {
  // shownStatus is already narrowed to TimelineStatus (unknown values fall
  // back to "geplant"); for relative phases it follows the calendar. The state
  // itself is named by the section heading, so the card shows only the time.
  const status = entry.shownStatus;
  const parts = entry.eventDate
    ? dateParts(status, entry.eventDate, now)
    : entry.phaseLabel
      ? [entry.phaseLabel]
      : [];
  return (
    <li
      className="rounded-xl border border-border bg-bg-primary p-6 md:p-7"
    >
      {parts.length > 0 && (
        <MetaRow>
          {parts.map((part, i) => (
            <Fragment key={part}>
              {i > 0 && <MetaDot />}
              <span className="tabular-nums">{part}</span>
            </Fragment>
          ))}
        </MetaRow>
      )}
      <p className={`${parts.length > 0 ? "mt-3 " : ""}text-lg font-semibold leading-snug text-fg-primary md:text-xl`}>
        {entry.title}
      </p>
      {entry.description && (
        <p className="mt-1.5 whitespace-pre-wrap text-base leading-relaxed text-fg-primary">
          {entry.description}
        </p>
      )}
    </li>
  );
}

function SectionHeader({
  id,
  title,
  count,
  icon,
  iconBgVar,
}: {
  id: string;
  title: string;
  count: number;
  icon: React.ReactNode;
  /** CSS variable for the solid swatch — matches the dashboard's
   *  MetricStatusBadge pattern (strong-colored circle, white symbol). */
  iconBgVar: string;
}) {
  return (
    <div>
      <h2 id={id} className="opa-h3 flex items-center gap-3 text-fg-primary">
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: iconBgVar }}
        >
          {icon}
        </span>
        <span>
          {title} <span className="font-normal text-fg-secondary tabular-nums">{count}</span>
        </span>
      </h2>
    </div>
  );
}

/**
 * Order entries within a status section. Two kinds coexist:
 *  - dated, admin-authored entries (real calendar events) → sorted by date,
 *    `dir` = -1 for most-recent-first (active/completed), 1 for soonest-first
 *    (upcoming).
 *  - date-less relative-phase steps from the default journey → sorted by
 *    `sortOrder` ascending, i.e. plan order (Woche 1 bis 2 → … → Nach 90 Tagen).
 * When a section mixes both, concrete dated entries come first and the generic
 * phase steps follow.
 */
function makeComparator(dir: 1 | -1) {
  return (a: ShownEntry, b: ShownEntry): number => {
    const at = a.eventDate ? a.eventDate.getTime() : null;
    const bt = b.eventDate ? b.eventDate.getTime() : null;
    if (at !== null && bt !== null) return (at - bt) * dir;
    if (at === null && bt === null) return a.sortOrder - b.sortOrder;
    return at === null ? 1 : -1;
  };
}

export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  const now = new Date();

  // Relative phases ("Woche 1 bis 2") get their state from the calendar: the
  // journey starts the day it was set up for this Praxis.
  const start = journeyStart(entries);
  const week = start ? currentJourneyWeek(start, now) : null;
  const shown: ShownEntry[] = entries.map((e) => ({
    ...e,
    shownStatus: effectiveStatus(e, week),
  }));

  const active = shown
    .filter((e) => e.shownStatus === "laeuft")
    .sort(makeComparator(-1));
  // Anything that is not running or done counts as upcoming, including a
  // status value this page does not know yet (effectiveStatus maps it to
  // "geplant"), so no admin entry ever silently disappears.
  const upcoming = shown
    .filter((e) => e.shownStatus === "geplant")
    .sort(makeComparator(1));
  const completed = shown
    .filter((e) => e.shownStatus === "abgeschlossen")
    .sort(makeComparator(-1));
  // Completed relative phases have no date, so they cannot sit in a month
  // group; they are listed in plan order above the dated history.
  const completedPhases = completed
    .filter((e) => !e.eventDate)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const completedDated = completed.filter((e) => e.eventDate);
  // The week box names a step of the plan, never a recommendation or a
  // dated one-off entry.
  const runningStep = active.find(isPhaseStep);
  const nextStep = upcoming.find(isPhaseStep);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Milestone className="h-8 w-8" />}
        title="Noch keine Einträge"
        description="Sobald wir an etwas arbeiten, sehen Sie es hier."
      />
    );
  }

  return (
    <div className="space-y-12">
      {start && week != null && (
        <div className="rounded-2xl border border-border bg-bg-secondary px-5 py-4 md:px-6">
          <p className="text-lg font-semibold text-fg-primary md:text-xl">
            Sie sind in Woche {week}.
          </p>
          <p className="mt-1 text-base text-fg-primary">
            Gezählt ab Ihrem Start am {formatDate(start)}.{" "}
            {runningStep
              ? `Gerade läuft: ${runningStep.title}.`
              : nextStep
                ? `Als Nächstes: ${nextStep.title}.`
                : ""}
          </p>
        </div>
      )}

      {active.length > 0 && (
        <section aria-labelledby="aktuell-heading" className="space-y-4">
          <SectionHeader
            id="aktuell-heading"
            title="Wir arbeiten gerade daran"
            count={active.length}
            icon={<Activity className="h-4 w-4" strokeWidth={2.5} />}
            iconBgVar="var(--accent)"
          />
          <ul className="space-y-3">
            {active.map((e) => (
              <TimelineCard key={e.id} entry={e} now={now} />
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="anstehend-heading" className="space-y-4">
          <SectionHeader
            id="anstehend-heading"
            title="Als Nächstes"
            count={upcoming.length}
            icon={<Clock className="h-4 w-4" strokeWidth={2.5} />}
            iconBgVar="var(--tone-warn)"
          />
          <ul className="space-y-3">
            {upcoming.map((e) => (
              <TimelineCard key={e.id} entry={e} now={now} />
            ))}
          </ul>
        </section>
      )}

      {completed.length > 0 && (
        <section aria-labelledby="verlauf-heading" className="space-y-5">
          <SectionHeader
            id="verlauf-heading"
            title="Was bisher passiert ist"
            count={completed.length}
            icon={<History className="h-4 w-4" strokeWidth={2.5} />}
            iconBgVar="var(--tone-good)"
          />
          <div className="space-y-6">
            {completedPhases.length > 0 && (
              <ul className="space-y-3">
                {completedPhases.map((e) => (
                  <TimelineCard key={e.id} entry={e} now={now} />
                ))}
              </ul>
            )}
            {groupByMonth(completedDated).map((g) => (
              <div key={g.label}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-sm font-medium text-fg-primary md:text-base">
                    {g.label}
                  </h3>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <ul className="space-y-3">
                  {g.entries.map((e) => (
                    <TimelineCard key={e.id} entry={e} now={now} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
