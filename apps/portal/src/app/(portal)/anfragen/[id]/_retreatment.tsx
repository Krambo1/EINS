import Link from "next/link";
import { cn } from "@eins/ui";
import { formatDate, formatMoney } from "@/lib/formatting";
import {
  calledTerminHoldSince,
  retreatmentTagState,
  type RetreatmentCall,
  type RetreatmentContext,
} from "@/server/queries/retreatments";
import { DashCard } from "../../dashboard/_components/dash-ui";
import { Facts } from "../_components/Facts";
import { dueText, lastCallText, reminderText } from "../_lib/retreatment-text";
import { RetreatmentStanding, RetreatmentToggle } from "./_retreatment-toggle";

/** Where one cycle stands, as a dot and words (like StatusPill). */
function standing(call: RetreatmentCall, today: string): { dot: string; text: string } {
  if (call.status === "returned") return { dot: "bg-tone-good", text: `Wiedergekommen am ${formatDate(call.returnedOn)}` };
  if (call.status === "dismissed") return { dot: "bg-fg-tertiary", text: "Ausgeblendet" };
  const state = retreatmentTagState(call, today, calledTerminHoldSince(new Date()));
  if (state === "termin") {
    return {
      dot: "bg-tone-good",
      text: call.status === "booked" ? `Termin am ${formatDate(call.bookedFor)}` : "Termin am Telefon vereinbart",
    };
  }
  return { dot: state === "faellig" ? "bg-tone-warn" : "bg-fg-tertiary", text: dueText(call, today) };
}

/**
 * The patient's Wiederbehandlungen on their Anfrage: per treatment where it
 * stands, when it was last done and paid, the reminder, the last call from
 * the call cards, and the way to take it off the calendar or back on.
 * Everything the old Wiederbehandlungen card showed about one person
 * (Karam, 2026-10-29: nothing of it may get lost). Only when there is one.
 */
export function RetreatmentSection({
  data,
  name,
  canWork,
  isInhaber,
  className,
}: {
  data: RetreatmentContext & { calls: RetreatmentCall[] };
  name: string;
  canWork: boolean;
  isInhaber: boolean;
  className?: string;
}) {
  const { today } = data;
  return (
    <DashCard title="Wiederbehandlung" className={className}>
      <ul className="-my-3 divide-y divide-border">
        {data.calls.map((call) => {
          const dismissed = call.status === "dismissed";
          const switchable = canWork && (call.status === "open" || call.status === "booked" || dismissed);
          // The line when it is on the calendar. A hidden one gets it as
          // "open" (what a restore sets), so the toggle can show it at once.
          const on = standing(dismissed ? { ...call, status: "open" } : call, today);
          const off = { dot: "bg-fg-tertiary", text: "Ausgeblendet" };
          const lastCall = lastCallText(call);
          const paid =
            call.cycleRevenueCents && call.cycleRevenueCents > 0
              ? formatMoney(call.cycleRevenueCents / 100, data.currency)
              : null;
          return (
            <li key={call.id} className="py-3">
              {/* Treatment and its switch on one line, where it stands under
                  both at full width, so the switch never squeezes it. */}
              <div className="flex min-h-[var(--control-h)] items-center justify-between gap-3">
                <p className="min-w-0 break-words text-[15px] font-medium leading-5 text-fg-primary">{call.treatmentName}</p>
                {switchable && (
                  <RetreatmentToggle cycleId={call.id} dismissed={dismissed} treatment={call.treatmentName} name={name} />
                )}
              </div>
              <p className="mt-1 flex text-sm leading-5 text-fg-primary">
                {switchable ? (
                  <RetreatmentStanding cycleId={call.id} dismissed={dismissed} on={on} off={off} />
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", on.dot)} />
                    {on.text}
                  </span>
                )}
              </p>
              <Facts>
                {`Zuletzt am ${formatDate(call.cycleOn)}${paid ? `, ${paid} bezahlt` : ""}`}
                {`Erinnerung: ${reminderText(call, today, data.remindersEnabled)}`}
                {!data.remindersEnabled && isInhaber && (
                  <Link
                    href="/einstellungen#wiederbehandlungen"
                    className="inline-block h-5 rounded-[var(--r-small)] align-top font-medium text-fg-primary underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Einschalten
                  </Link>
                )}
                {lastCall && `Letzter Anruf: ${lastCall}`}
              </Facts>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}
