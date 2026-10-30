import { cn } from "@eins/ui";
import { AlarmClock, AlertTriangle, Clock } from "lucide-react";
import { HOVER_CARD } from "../../dashboard/_components/hover-card";
import type { RowTiming } from "../_lib/row-timing";
import { describeTiming } from "./TimingLine";

/**
 * The signal of a row as one icon in a fixed slot before the name, like the
 * priority icon in Linear's issue list: every row keeps the same height, and
 * names start at the same x whether a row has a signal or not. The words
 * ("Überfällig", "Von der Praxis nicht beantwortet", "Wiedervorlage fällig")
 * and their explanation float in a hover card over the icon; screen readers
 * get them as text.
 *
 * Icon: a red or amber triangle once the Frist is missed, an amber alarm
 * clock for a due Wiedervorlage, a grey clock while the Frist still runs.
 */
export function RowSignal({
  timing,
  followupDue = false,
  className,
}: {
  timing: RowTiming | null;
  followupDue?: boolean;
  className?: string;
}) {
  const t = timing ? describeTiming(timing) : null;
  const late = timing?.kind === "deadline" && timing.late;
  const parts: { title: string; hints: string[] }[] = [];
  if (t) parts.push({ title: late ? `Rückruf-Ziel verpasst: ${t.text}` : t.text, hints: t.hints });
  if (followupDue) parts.push({ title: "Wiedervorlage fällig", hints: [] });

  let icon = null;
  if (t?.urgent) {
    icon = (
      <AlertTriangle
        className={cn("h-4 w-4", t.tone === "bad" ? "text-tone-bad" : "text-tone-warn")}
      />
    );
  } else if (followupDue) {
    icon = <AlarmClock className="h-4 w-4 text-tone-warn" />;
  } else if (t) {
    icon = <Clock className="h-4 w-4 text-fg-tertiary" />;
  }

  return (
    <span className={cn("group/sig relative flex h-5 w-4 shrink-0 items-center justify-center", className)}>
      {icon && (
        <>
          <span aria-hidden>{icon}</span>
          <span className="sr-only">{parts.map((p) => p.title).join(", ")}. </span>
          <span
            aria-hidden
            // Wide enough that the longest explanation ("nicht beantwortet")
            // reads in a few lines instead of a narrow column over the rows.
            className={cn(HOVER_CARD, "-left-3 hidden w-96 max-w-[calc(100vw-2rem)] whitespace-normal group-hover/sig:block")}
          >
            {parts.map((p, i) => (
              <span key={i} className={cn("block", i > 0 && "mt-3")}>
                <span className="block text-sm font-semibold leading-5 text-fg-primary">{p.title}</span>
                {p.hints.map((h, j) => (
                  <span key={j} className="mt-1 block text-sm leading-5 text-fg-primary">
                    {h}
                  </span>
                ))}
              </span>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
