import { ExplainerPopover, cn } from "@eins/ui";
import { AlertTriangle, Clock } from "lucide-react";
import { RESPONSE_STATE_LABELS } from "@/lib/response-time";
import { formatBerlinDateTime } from "@/lib/werkstunden";
import type { RowTiming } from "../_lib/row-timing";
import { formatDeadlineShort } from "../_lib/deadline";
import {
  DEADLINE_RUNNING_HINT,
  LATE_HINT,
  NOT_ANSWERED_HINT,
  OVERDUE_HINT,
} from "../_lib/response-hints";

/**
 * The single timing line of an Anfrage row (see `rowTiming`). Always icon
 * first, then dark text, so the lines of a list start at the same x: a grey
 * clock while the Frist runs, a red or amber triangle once it is urgent.
 *
 * The explanation sits in `title`; `explain` adds an (i) popover instead.
 * Keep `explain` off inside row links (a button inside a link is invalid and
 * the tap would open the row).
 */
export function TimingLine({
  timing,
  explain = false,
  className,
}: {
  timing: RowTiming | null;
  explain?: boolean;
  className?: string;
}) {
  if (!timing) return null;
  const { text, hints, urgent, tone } = describe(timing);
  const Icon = urgent ? AlertTriangle : Clock;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-sm font-medium tabular-nums text-fg-primary",
        className
      )}
      title={explain ? undefined : hints.join(" ")}
    >
      <Icon
        aria-hidden
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          tone === "bad" ? "text-tone-bad" : tone === "warn" ? "text-tone-warn" : "text-fg-secondary"
        )}
      />
      {timing.kind === "deadline" && timing.late && (
        <span className="sr-only">Rückruf-Ziel verpasst. </span>
      )}
      <span className="min-w-0 truncate">{text}</span>
      {explain && (
        <ExplainerPopover term={text} ariaLabel={`Erklärung: ${text}`}>
          {hints.map((h, i) => (
            <p key={i} className={i > 0 ? "mt-2" : undefined}>
              {h}
            </p>
          ))}
        </ExplainerPopover>
      )}
    </span>
  );
}

function describe(timing: RowTiming): {
  text: string;
  hints: string[];
  urgent: boolean;
  tone: "bad" | "warn" | "neutral";
} {
  if (timing.kind === "deadline") {
    return {
      text: `Kontaktieren bis ${formatDeadlineShort(timing.deadline)}`,
      hints: timing.late ? [DEADLINE_RUNNING_HINT, OVERDUE_HINT] : [DEADLINE_RUNNING_HINT],
      urgent: timing.late,
      tone: timing.late ? "bad" : "neutral",
    };
  }
  if (timing.kind === "flag") {
    const deadlineText = timing.deadline
      ? `48-Werkstunden-Frist bis ${formatBerlinDateTime(timing.deadline)} Uhr.`
      : null;
    const hint = timing.state === "nicht_beantwortet" ? NOT_ANSWERED_HINT : LATE_HINT;
    return {
      text: RESPONSE_STATE_LABELS[timing.state],
      hints: deadlineText ? [deadlineText, hint] : [hint],
      urgent: true,
      tone: timing.state === "nicht_beantwortet" ? "bad" : "warn",
    };
  }
  return { text: "Überfällig", hints: [OVERDUE_HINT], urgent: true, tone: "bad" };
}
