import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { formatDate, formatMoney } from "@/lib/formatting";
import {
  calledTerminHoldSince,
  retreatmentTagState,
  type RetreatmentCall,
  type RetreatmentContext,
} from "@/server/queries/retreatments";
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
 * The patient's Wiederbehandlungen on their Anfrage: per treatment when it
 * was last done and paid, when it is due again, the reminder, the last call
 * from the call cards, and the way to take it off the calendar or back on.
 * Everything the old Wiederbehandlungen card showed about one person
 * (Karam, 2026-10-29: nothing of it may get lost). Only when there is one.
 */
export function RetreatmentSection({
  data,
  canWork,
  isInhaber,
}: {
  data: RetreatmentContext & { calls: RetreatmentCall[] };
  canWork: boolean;
  isInhaber: boolean;
}) {
  const { today } = data;
  return (
    <Card className="p-5 md:p-6">
      <CardHeader className="mb-3">
        <CardTitle>Wiederbehandlung</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-primary">
          Wann diese Person für dieselbe Behandlung wieder fällig ist, aus Ihren eigenen PVS-Daten. Fällige
          stehen unter Anfragen bei den Anrufen.
          {!data.remindersEnabled && (
            <>
              {" "}
              Erinnerungs-E-Mails sind aus.
              {isInhaber && (
                <>
                  {" "}
                  <Link
                    href="/einstellungen#wiederbehandlungen"
                    className="rounded-[var(--r-small)] font-medium underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Einschalten
                  </Link>
                </>
              )}
            </>
          )}
        </p>
        <ul className="divide-y divide-border">
          {data.calls.map((call) => {
            const dismissed = call.status === "dismissed";
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
              <li
                key={call.id}
                className="grid gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-medium leading-5 text-fg-primary">
                    {call.treatmentName}
                    {canWork && (call.status === "open" || call.status === "booked" || dismissed) ? (
                      <RetreatmentStanding cycleId={call.id} dismissed={dismissed} on={on} off={off} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${on.dot}`} />
                        {on.text}
                      </span>
                    )}
                  </p>
                  <Facts>
                    {`Zuletzt am ${formatDate(call.cycleOn)}${paid ? `, ${paid} bezahlt` : ""}`}
                    {`Erinnerung: ${reminderText(call, today, data.remindersEnabled)}`}
                    {lastCall && `Letzter Anruf: ${lastCall}`}
                  </Facts>
                </div>
                {canWork && (call.status === "open" || call.status === "booked" || dismissed) && (
                  <RetreatmentToggle
                    cycleId={call.id}
                    dismissed={dismissed}
                    treatment={call.treatmentName}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
