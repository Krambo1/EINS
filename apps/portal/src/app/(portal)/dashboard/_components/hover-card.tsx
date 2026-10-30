import type { ReactNode } from "react";
import { cn } from "@eins/ui";

/** Frame of a card floating over a chart column: sized to its content,
 *  raised over the chart. Position it with `left-0`, `right-0` or centred. */
export const HOVER_CARD =
  "pointer-events-none absolute bottom-full z-20 mb-2 w-max whitespace-nowrap rounded-[var(--r-panel)] bg-[var(--surface-tile)] p-3 elev-popover";

export interface HoverCardLine {
  label: string;
  value: string;
  /** Second, quieter chip after the value ("31 % aller Anfragen"). */
  extra?: string;
}

/**
 * Body of a chart hover card, like Attio's chart cards: the name, then a bar
 * in the column's colour beside a few figures, each value in a grey chip.
 */
export function HoverCardBody({
  title,
  color,
  lines,
}: {
  title: ReactNode;
  color: string;
  lines: HoverCardLine[];
}) {
  return (
    <>
      <p className="text-sm font-semibold leading-5 text-fg-primary">{title}</p>
      <div className="mt-2 flex gap-2.5">
        <span aria-hidden className="w-[3px] shrink-0 rounded-full" style={{ background: color }} />
        <dl className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5">
          {lines.map((l) => (
            <div key={l.label} className="contents">
              <dt className="text-sm text-fg-secondary">{l.label}</dt>
              <dd className="flex items-center gap-1.5">
                <Chip>{l.value}</Chip>
                {l.extra && <Chip quiet>{l.extra}</Chip>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

/** A value in a grey chip (Attio). */
function Chip({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-[var(--r-small)] border border-border bg-[var(--well)] px-1.5 text-[13px] leading-5 tabular-nums",
        quiet ? "text-fg-secondary" : "font-semibold text-fg-primary"
      )}
    >
      {children}
    </span>
  );
}

/**
 * Base line under a column chart: a 2 px rule the columns stand on. Their
 * drop shadow stops at it (`COLUMN_CLIP` on each column).
 */
export function ChartFloor() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-[var(--border-hover)]"
    />
  );
}

/** Clips a column's shadow at its base, so it never falls across the line. */
export const COLUMN_CLIP = "inset(-16px -16px 0 -16px)";

/** Light from above on a coloured fill, like `.bar-solid`: brighter at the
 *  top, a touch darker at the base. Layer it over a background colour. */
export const LIT_FROM_ABOVE =
  "linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0) 55%, rgba(16, 16, 26, 0.08) 100%)";
