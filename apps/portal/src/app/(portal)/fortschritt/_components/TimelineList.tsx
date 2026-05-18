import { EmptyState } from "@eins/ui";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  Milestone,
} from "lucide-react";
import { formatDate } from "@/lib/formatting";
import { TIMELINE_STATUS_LABELS } from "@/lib/constants";
import type { TimelineEntry } from "@/server/queries/timeline";

const MONTH_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(date: Date, ref: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return Math.round((a - b) / MS_PER_DAY);
}

function activeDurationLabel(date: Date, now: Date): string {
  const d = daysBetween(now, date);
  if (d <= 0) return "Heute gestartet";
  if (d === 1) return "Seit gestern aktiv";
  if (d < 14) return `Seit ${d} Tagen aktiv`;
  if (d < 60) return `Seit ${Math.round(d / 7)} Wochen aktiv`;
  return `Seit ${Math.round(d / 30)} Monaten aktiv`;
}

function upcomingDistanceLabel(date: Date, now: Date): string {
  const d = daysBetween(date, now);
  if (d <= 0) return "Heute geplant";
  if (d === 1) return "Morgen";
  if (d < 14) return `In ${d} Tagen`;
  if (d < 60) return `In ${Math.round(d / 7)} Wochen`;
  return `In ${Math.round(d / 30)} Monaten`;
}

function groupByMonth(entries: TimelineEntry[]) {
  const groups = new Map<string, { label: string; entries: TimelineEntry[] }>();
  for (const e of entries) {
    const d = e.eventDate;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) {
      groups.set(key, { label: MONTH_FORMATTER.format(d), entries: [] });
    }
    groups.get(key)!.entries.push(e);
  }
  return Array.from(groups.values());
}

function MetaRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
      {children}
    </div>
  );
}

function MetaDot() {
  return (
    <span aria-hidden className="text-fg-tertiary">
      ·
    </span>
  );
}

function ActiveCard({ entry, now }: { entry: TimelineEntry; now: Date }) {
  return (
    <li className="relative overflow-hidden rounded-xl border border-border bg-bg-primary p-5 before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent">
      <MetaRow>
        <span className="inline-flex items-center gap-1.5 font-medium text-accent">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          {TIMELINE_STATUS_LABELS.laeuft}
        </span>
        <MetaDot />
        <span>{activeDurationLabel(entry.eventDate, now)}</span>
        <MetaDot />
        <span className="tabular-nums">{formatDate(entry.eventDate)}</span>
      </MetaRow>
      <p className="mt-2 text-base font-semibold leading-snug text-fg-primary">
        {entry.title}
      </p>
      {entry.description && (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
          {entry.description}
        </p>
      )}
    </li>
  );
}

function UpcomingCard({ entry, now }: { entry: TimelineEntry; now: Date }) {
  return (
    <li className="rounded-xl border border-border bg-bg-primary p-5 transition-colors hover:border-border-hover">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-secondary/60 text-fg-secondary">
          <CalendarClock className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <MetaRow>
            <span className="font-medium text-fg-primary">
              {upcomingDistanceLabel(entry.eventDate, now)}
            </span>
            <MetaDot />
            <span className="tabular-nums">{formatDate(entry.eventDate)}</span>
          </MetaRow>
          <p className="mt-2 text-base font-semibold leading-snug text-fg-primary">
            {entry.title}
          </p>
          {entry.description && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
              {entry.description}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function CompletedItem({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="relative pl-10">
      <span
        aria-hidden
        className="absolute left-0 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-primary ring-4 ring-bg-secondary"
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-tone-good" />
      </span>
      <div className="rounded-xl border border-border bg-bg-primary p-4">
        <div className="text-sm text-fg-secondary tabular-nums">
          {formatDate(entry.eventDate)}
        </div>
        <p className="mt-1 text-base font-semibold leading-snug text-fg-primary">
          {entry.title}
        </p>
        {entry.description && (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
            {entry.description}
          </p>
        )}
      </div>
    </li>
  );
}

function SectionHeader({
  id,
  title,
  count,
  countLabel,
  icon,
  iconBgVar,
}: {
  id: string;
  title: string;
  count: number;
  countLabel?: string;
  icon: React.ReactNode;
  /** CSS variable for the solid swatch — matches the dashboard's
   *  MetricStatusBadge pattern (strong-colored circle, white symbol). */
  iconBgVar: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="opa-h3 flex items-center gap-3 text-fg-primary">
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: iconBgVar }}
        >
          {icon}
        </span>
        {title}
      </h2>
      <span className="text-sm text-fg-tertiary tabular-nums">
        {count}
        {countLabel ? ` ${countLabel}` : ""}
      </span>
    </div>
  );
}

export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  const now = new Date();

  const active = entries
    .filter((e) => e.status === "laeuft")
    .slice()
    .sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());
  const upcoming = entries
    .filter((e) => e.status === "geplant")
    .slice()
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  const completed = entries
    .filter((e) => e.status === "abgeschlossen")
    .slice()
    .sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());

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
              <ActiveCard key={e.id} entry={e} now={now} />
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
            countLabel="geplant"
            icon={<Clock className="h-4 w-4" strokeWidth={2.5} />}
            iconBgVar="var(--tone-warn)"
          />
          <ul className="space-y-3">
            {upcoming.map((e) => (
              <UpcomingCard key={e.id} entry={e} now={now} />
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
            countLabel="erledigt"
            icon={<History className="h-4 w-4" strokeWidth={2.5} />}
            iconBgVar="var(--tone-good)"
          />

          {/* One continuous timeline line for the whole "completed" column.
              `top-3` / `bottom-3` align it to the centers of the first and
              last check-circles (each circle sits at top-3 with h-7 → center
              at y=12+14=26, line at x=13 runs through the center). The line
              passes BEHIND every circle and every month divider — circles
              have an opaque bg-bg-primary fill that masks it locally, so it
              reads as one thread the check-marks are pinned onto. */}
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-3 left-[13px] top-3 w-px bg-border-hover"
            />
            <div className="space-y-6">
              {groupByMonth(completed).map((g) => (
                <div key={g.label}>
                  <div className="mb-3 flex items-center gap-3 pl-10">
                    <h3 className="text-sm font-medium text-fg-secondary">
                      {g.label}
                    </h3>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <ol className="space-y-3">
                    {g.entries.map((e) => (
                      <CompletedItem key={e.id} entry={e} />
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
