import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@eins/ui";
import { CONTROL, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { ExplainerPopover } from "../../_components/ExplainerPopover";
import { CARD_PAD, CHECKBOX, FIELD, ONE_LINE, SECTION_SCROLL, SELECT } from "../_lib/sizes";

/**
 * The parts every Einstellungen card is built from, so each card looks and
 * saves the same way:
 *
 * - `SettingsCard`: the Übersicht's card (DashCard) with an anchor, its
 *   content edge to edge, so a form can hold the body and the foot.
 * - `CardBody`, `CardFoot`: the fields, then the foot with "Speichern" at its
 *   right end, a hairline above (Vercel's settings cards; the foot of the
 *   "Dateien senden" panel). Every card that saves has it in the same place.
 * - `Field`, `TextInput`, `Select`, `CheckRow`: a label over a field pressed
 *   into the card, at most one (i) beside the label; a box to tick with its
 *   text beside it (Linear's settings rows).
 * - `Status`: a dot plus plain text (DESIGN.md section 5), the same words on
 *   every card: Aktiv, Einladung offen, An, Aus, Verbunden.
 */
export function SettingsCard({
  id,
  title,
  titleExtra,
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  titleExtra?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashCard id={id} title={title} titleExtra={titleExtra} action={action} className={SECTION_SCROLL} bodyClassName="p-0 md:p-0">
      {children}
    </DashCard>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(CARD_PAD, "pb-5 pt-4 md:pb-6", className)}>{children}</div>;
}

/** The foot of a card: `start` on the left (a quiet link), the save on the right. */
export function CardFoot({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn(CARD_PAD, "flex items-center justify-between gap-3 border-t border-border py-4")}>
      <div className="min-w-0">{start}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** The save of a card and the one action that fixes a row: dark, full control height. */
export const PRIMARY_BUTTON = cn(CONTROL, "px-4");

/** Every other button: raised, white (Stripe's "Export", Attio's record buttons). */
export const SECONDARY_BUTTON = cn(RAISED_CONTROL, CONTROL, "px-3.5");

/**
 * A row's button that is a square with its icon below lg and shows its word
 * from lg (Dateien's "Herunterladen"), so a row of a list keeps one line at
 * 390. The button carries the full name as `aria-label`.
 */
export const ROW_BUTTON = cn(RAISED_CONTROL, CONTROL, "w-[var(--control-h)] shrink-0 px-0 lg:w-auto lg:px-3.5");

/**
 * Two fields side by side from md, one under the other on the phone. Aligned
 * at their foot, so the two fields of a row line up when one label wraps and
 * the other does not (a form with lines under its fields sets `items-start`).
 */
export const FIELD_GRID = "grid items-end gap-x-4 gap-y-5 md:grid-cols-2";

/**
 * A label above its field. `explain` adds the (i) beside the label: where to
 * find the value, what it is for. `aside` sits at the label row's right end
 * (a link that helps to fill the field).
 */
export function Field({
  label,
  htmlFor,
  explain,
  aside,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  explain?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <label htmlFor={htmlFor} className="text-sm font-medium leading-5 text-fg-primary">
            {label}
          </label>
          {explain && <ExplainerPopover term={label}>{explain}</ExplainerPopover>}
        </div>
        {aside}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(FIELD, className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select {...props} className={SELECT}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-secondary"
      />
    </div>
  );
}

/**
 * A value that cannot be typed here, at the height of a field, so it lines up
 * with one; a long one scrolls sideways on its line.
 */
export function FieldValue({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[var(--control-h)] items-center">
      <span className={cn(ONE_LINE, "min-w-0 text-[15px] leading-6 text-fg-primary")}>{children}</span>
    </div>
  );
}

/** A box to tick with its name and, below, what ticking it means. */
export function CheckRow({
  name,
  defaultChecked,
  label,
  children,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
  /** What ticking it says or does, in full. */
  children?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className={CHECKBOX} />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-6 text-fg-primary">{label}</span>
        {children && <span className="mt-0.5 block text-sm leading-5 text-fg-secondary">{children}</span>}
      </span>
    </label>
  );
}

/**
 * A part of a long card ("Sternwerte"): a hairline across the card above it,
 * its name, and the one action that belongs to it at the right end.
 */
export function SubHead({ title, explain, action }: { title: string; explain?: ReactNode; action?: ReactNode }) {
  return (
    <div className="-mx-5 flex min-h-[calc(var(--control-h)+1rem)] items-center justify-between gap-3 border-t border-border px-5 pt-4 md:-mx-6 md:px-6">
      <div className="flex min-w-0 items-center gap-1">
        <h3 className="text-[15px] font-semibold leading-6 text-fg-primary">{title}</h3>
        {explain && <ExplainerPopover term={title}>{explain}</ExplainerPopover>}
      </div>
      {action}
    </div>
  );
}

export type Tone = "good" | "warn" | "bad" | "none";

const DOT: Record<Tone, string> = {
  good: "bg-tone-good",
  warn: "bg-tone-warn",
  bad: "bg-tone-bad",
  none: "bg-[var(--border-hover)]",
};

export function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", DOT[tone])} />;
}

/** Status as a dot and plain dark text, never a badge. */
export function Status({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-fg-primary", className)}>
      <Dot tone={tone} />
      {children}
    </span>
  );
}
