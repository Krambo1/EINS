import { EmptyState } from "@eins/ui";
import {
  CheckCircle2,
  CalendarClock,
  Loader2,
  Milestone,
  Sparkles,
} from "lucide-react";
import { formatDate } from "@/lib/formatting";
import {
  TIMELINE_STATUS_LABELS,
  type TimelineStatus,
} from "@/lib/constants";
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

function StatTile({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: "accent" | "neutral" | "good";
}) {
  const active = count > 0;
  const toneClasses = {
    accent: active
      ? "border-accent/40 bg-accent-soft/30 text-accent"
      : "border-border bg-bg-secondary/40 text-fg-tertiary",
    neutral: active
      ? "border-border-hover bg-bg-secondary text-fg-primary"
      : "border-border bg-bg-secondary/40 text-fg-tertiary",
    good: active
      ? "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] text-tone-good"
      : "border-border bg-bg-secondary/40 text-fg-tertiary",
  }[tone];

  return (
    <div
      className={`relative overflow-hidden rounded-xl border px-4 py-3 transition-colors ${toneClasses}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold leading-none tabular-nums md:text-3xl">
          {count}
        </span>
        {tone === "accent" && active && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] opacity-80">
        {label}
      </div>
    </div>
  );
}

function ActiveCard({ entry, now }: { entry: TimelineEntry; now: Date }) {
  return (
    <li className="relative overflow-hidden rounded-xl border border-accent/30 bg-bg-primary/60 p-4 shadow-[0_0_0_1px_var(--accent-glow)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-accent/10 blur-2xl"
      />
      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent-soft/40 text-accent">
          <Loader2 className="h-4 w-4 animate-spin [animation-duration:3s]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 font-mono uppercase tracking-wider text-accent">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              {TIMELINE_STATUS_LABELS.laeuft}
            </span>
            <span className="text-fg-secondary">
              {activeDurationLabel(entry.eventDate, now)}
            </span>
            <span className="text-fg-tertiary">·</span>
            <span className="font-mono text-fg-tertiary tabular-nums">
              {formatDate(entry.eventDate)}
            </span>
          </div>
          <p className="mt-1.5 text-base font-semibold leading-snug text-fg-primary">
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

function UpcomingCard({ entry, now }: { entry: TimelineEntry; now: Date }) {
  return (
    <li className="group relative rounded-xl border border-border bg-bg-secondary/40 p-4 transition-colors hover:border-border-hover">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-primary/60 text-fg-secondary">
          <CalendarClock className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex items-center rounded-full border border-border bg-bg-primary/60 px-2 py-0.5 font-mono uppercase tracking-wider text-fg-secondary">
              {TIMELINE_STATUS_LABELS.geplant}
            </span>
            <span className="font-medium text-fg-primary">
              {upcomingDistanceLabel(entry.eventDate, now)}
            </span>
            <span className="text-fg-tertiary">·</span>
            <span className="font-mono text-fg-tertiary tabular-nums">
              {formatDate(entry.eventDate)}
            </span>
          </div>
          <p className="mt-1.5 text-base font-semibold leading-snug text-fg-primary">
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
        className="absolute left-0 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] ring-4 ring-bg-primary"
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-tone-good" />
      </span>
      <div className="rounded-xl border border-border bg-bg-secondary/30 p-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center rounded-full border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-2 py-0.5 font-mono uppercase tracking-wider text-tone-good">
            {TIMELINE_STATUS_LABELS.abgeschlossen}
          </span>
          <span className="font-mono text-fg-tertiary tabular-nums">
            {formatDate(entry.eventDate)}
          </span>
        </div>
        <p className="mt-1.5 text-base font-semibold leading-snug text-fg-primary">
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
    <div className="space-y-8">
      {/* Activity strip — live counts give the page a pulse */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile count={active.length} label="Läuft" tone="accent" />
        <StatTile count={upcoming.length} label="Geplant" tone="neutral" />
        <StatTile count={completed.length} label="Abgeschlossen" tone="good" />
      </div>

      {active.length > 0 && (
        <section aria-labelledby="aktuell-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="aktuell-heading"
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-accent"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Wir arbeiten gerade daran
            </h2>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-fg-tertiary">
              <Sparkles className="h-3 w-3" />
              Live für Sie
            </span>
          </div>
          <ul className="space-y-2.5">
            {active.map((e) => (
              <ActiveCard key={e.id} entry={e} now={now} />
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="anstehend-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="anstehend-heading"
              className="text-xs font-mono uppercase tracking-[0.18em] text-fg-secondary"
            >
              Als Nächstes
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-wider text-fg-tertiary">
              {upcoming.length} geplant
            </span>
          </div>
          <ul className="space-y-2.5">
            {upcoming.map((e) => (
              <UpcomingCard key={e.id} entry={e} now={now} />
            ))}
          </ul>
        </section>
      )}

      {completed.length > 0 && (
        <section aria-labelledby="verlauf-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="verlauf-heading"
              className="text-xs font-mono uppercase tracking-[0.18em] text-fg-secondary"
            >
              Was bisher passiert ist
            </h2>
            <span className="text-[11px] font-mono uppercase tracking-wider text-fg-tertiary">
              {completed.length} erledigt
            </span>
          </div>

          <div className="relative space-y-5">
            {groupByMonth(completed).map((g, gi) => (
              <div key={g.label} className="relative">
                <div className="mb-2 flex items-center gap-3 pl-10">
                  <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-tertiary">
                    {g.label}
                  </h3>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <ol className="relative space-y-2.5 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
                  {g.entries.map((e) => (
                    <CompletedItem key={e.id} entry={e} />
                  ))}
                </ol>
                {gi < groupByMonth(completed).length - 1 && (
                  <div className="h-3" />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
