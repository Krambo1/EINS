import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { cn } from "@eins/ui";

/**
 * Headline of every card and Kennzahl on the Übersicht ("Anfragen",
 * "Termine", "Offene Anfragen", "Trichter", ...): one size and weight, so no
 * card shouts louder than another.
 */
export const CARD_TITLE = "text-base font-semibold leading-5 text-fg-primary";

/**
 * A card title that leads to the page behind the card (Karam, 2026-10-30:
 * a tap on the title word opens the page; no extra "Alle ansehen" line). The
 * chevron after it says it is a link; on hover the title underlines and the
 * chevron darkens, nothing moves.
 */
export function TitleLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group/title relative z-10 inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-[var(--r-small)] decoration-fg-tertiary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="truncate">{children}</span>
      <ChevronRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-fg-tertiary transition-colors group-hover/title:text-fg-primary"
      />
    </Link>
  );
}

/**
 * Stripe's table anatomy, shared by every table and list on the Praxis side
 * (`BreakdownTable`, the Anfragen list): a quiet header row with a hairline
 * under it, then rows at least 44 px high with hairlines between them
 * (`divide-y divide-border` on the list).
 */
export const TABLE_HEAD = "h-7 border-b border-border text-sm text-fg-secondary";
export const TABLE_ROW = "min-h-11 py-2 transition-colors";

/**
 * Header of a long list as a band pressed into the card (Linear's group
 * header), instead of `TABLE_HEAD`'s hairline. Opt-in per list.
 */
export const TABLE_HEAD_BAND = "elev-inset h-8 rounded-[var(--r-control)] bg-[var(--well)] text-sm text-fg-secondary";

/**
 * A secondary button standing on its surface like the marked period and a
 * set filter chip (raised layer, DESIGN.md §5; Stripe's "Export", Attio's
 * record buttons): white, a hairline ring and a short shadow, no border.
 * Goes on `Button variant="outline"`; hover only greys the face a touch.
 */
export const RAISED_CONTROL =
  "elev-raised border-transparent bg-[var(--surface-raised)] text-fg-primary hover:border-transparent hover:bg-[color-mix(in_srgb,var(--surface-raised)_95%,var(--fg-primary))]";

/**
 * Size of every control on the Praxis side, whatever its style (DESIGN.md
 * section 5, "One control height"): 44 px on the phone, 40 px from sm, with
 * the control radius. Buttons, inputs, filter chips and menu triggers all
 * take it, so controls side by side never differ by a few pixels (Stripe's
 * and Linear's headers: one height per bar). Icon-only buttons add
 * `CONTROL_SQUARE`.
 */
export const CONTROL = "h-[var(--control-h)] rounded-[var(--r-control)]";
export const CONTROL_SQUARE = "w-[var(--control-h)] px-0";

/** Quiet text control on a card or the canvas ("Filter zurücksetzen"). */
export const QUIET_CONTROL =
  "inline-flex h-[var(--control-h)] items-center gap-1.5 rounded-[var(--r-control)] px-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-[var(--hover-wash)] hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Dashboard surfaces: a card standing on the page canvas (soft shadow, see
 * `.elev-card`) with a compact header. It rises in once when it first
 * appears and answers the pointer with a deeper shadow like every card
 * (`.lift`), without moving. Every card on the Übersicht uses this, so spacing and title size
 * are the same everywhere.
 */
export function DashCard({
  id,
  title,
  href,
  titleExtra,
  action,
  children,
  className,
  bodyClassName,
}: {
  /** Anchor for an in-page link to the card. */
  id?: string;
  title?: ReactNode;
  /** The page behind the card: the title becomes its link (`TitleLink`). */
  href?: string;
  /** Explainer popover or similar, right next to the title. */
  titleExtra?: ReactNode;
  /** Right side of the header (link, switch). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "anim-rise elev-card lift min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)] print:break-inside-avoid",
        className
      )}
    >
      {(title || action) && (
        // Same top padding as the Kennzahlen cells (20 px phone, 24 px md+),
        // so titles and labels line up across a row.
        <header className="flex min-h-8 items-center justify-between gap-3 px-5 pt-5 md:px-6 md:pt-6">
          {title && (
            <div className="flex min-w-0 items-center gap-1.5">
              {/* With a link only its text truncates, so the focus ring is
                  not clipped. */}
              <h2 className={cn(href ? "flex min-w-0" : "truncate", CARD_TITLE)}>
                {href ? <TitleLink href={href}>{title}</TitleLink> : title}
              </h2>
              {titleExtra}
            </div>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("px-5 pb-5 pt-4 md:px-6 md:pb-6", bodyClassName)}>{children}</div>
    </section>
  );
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * A figure whose digits roll into place: up from 0 when it first appears, and
 * from the old digit to the new one when the period changes. CSS only (see
 * `.roll-strip`), so the server HTML already holds the final value; screen
 * readers get the plain text, and reduced motion shows it standing still.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = Array.from(value);
  // Digits are keyed by their place from the right, so the ones stay the ones
  // (and roll instead of remounting) when the number gains a digit.
  const keys: string[] = [];
  let place = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    keys[i] = /\d/.test(chars[i]!) ? `d${place++}` : `c${chars.length - 1 - i}`;
  }
  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden>
        {chars.map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={keys[i]} className="roll-cell">
              <span className="roll-ghost">{ch}</span>
              <span
                className="roll-strip"
                style={{ "--d": ch, "--delay": `${i * 20}ms` } as CSSProperties}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={keys[i]}>{ch}</span>
          )
        )}
      </span>
    </span>
  );
}

export type DeltaTone = "good" | "bad" | "neutral";

/**
 * Change against the period before, as coloured text (no pill): arrow follows
 * the value direction, colour follows whether that direction is good for the
 * Praxis.
 */
export function DeltaText({
  pct,
  higherIsBetter = true,
  className,
}: {
  /** Fraction (0.12 = +12 %). null: nothing to compare against. */
  pct: number | null;
  higherIsBetter?: boolean;
  className?: string;
}) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.005;
  const up = pct > 0;
  const tone: DeltaTone = flat ? "neutral" : up === higherIsBetter ? "good" : "bad";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const abs = Math.abs(pct) * 100;
  const text = `${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1).replace(".", ",")} %`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-sm font-medium leading-none tabular-nums",
        tone === "good" && "text-tone-good",
        tone === "bad" && "text-tone-bad",
        tone === "neutral" && "text-fg-secondary",
        className
      )}
      aria-label={`${flat ? "unverändert" : `${up ? "+" : "−"}${text}`} vs. Vorperiode`}
      title="vs. Vorperiode"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {flat ? "0 %" : text}
    </span>
  );
}

/** Relative change of two totals; null when the prior total is 0. */
export function pctChange(current: number, prior: number): number | null {
  if (!Number.isFinite(prior) || prior === 0) return null;
  return (current - prior) / prior;
}
