import { formatDate, formatNumber, formatRelative } from "@/lib/formatting";
import {
  daysBetween,
  REMINDER_LEAD_DAYS,
  REMINDER_SKIP_REASON_LABELS,
  type ReminderSkipReason,
} from "@/lib/retreatment";
import type { RetreatmentCall, RetreatmentTag, RetreatmentTagState } from "@/server/queries/retreatments";

/**
 * The words for one Wiederbehandlung, the same in the call cards, the list
 * tag and on the Anfrage (they were the old calendar's columns).
 */

/** When it is due: "Seit 29 Tagen fällig", "Heute fällig", "Fällig am 12.11.2026". */
export function dueText(call: Pick<RetreatmentCall, "dueOn">, today: string): string {
  if (call.dueOn < today) {
    const d = daysBetween(call.dueOn, today);
    return d === 1 ? "Seit gestern fällig" : `Seit ${formatNumber(d)} Tagen fällig`;
  }
  if (call.dueOn === today) return "Heute fällig";
  return `Fällig am ${formatDate(call.dueOn)}`;
}

/** The same, short for the date slot of a row: "Seit 29 Tagen", "Heute", "12.11.2026". */
export function dueShort(call: Pick<RetreatmentCall, "dueOn">, today: string): string {
  if (call.dueOn < today) {
    const d = daysBetween(call.dueOn, today);
    return d === 1 ? "Seit gestern" : `Seit ${formatNumber(d)} Tagen`;
  }
  if (call.dueOn === today) return "Heute";
  return formatDate(call.dueOn);
}

/** Where the reminder e-mail stands for this person. */
export function reminderText(call: RetreatmentCall, today: string, remindersEnabled: boolean): string {
  if (call.status === "returned") return `Wiedergekommen am ${formatDate(call.returnedOn)}`;
  if (call.status === "dismissed") return "Keine, ausgeblendet";
  if (call.status === "booked") return `Termin am ${formatDate(call.bookedFor)}`;
  if (call.reminderStatus === "sent") {
    return `Erinnert am ${formatDate(call.reminderSentAt)}${call.bookingClickedAt ? ", Link geöffnet" : ""}`;
  }
  if (call.reminderStatus === "skipped") {
    const reason = call.reminderSkipReason as ReminderSkipReason | null;
    return reason && REMINDER_SKIP_REASON_LABELS[reason] ? REMINDER_SKIP_REASON_LABELS[reason] : "Keine E-Mail";
  }
  if (!remindersEnabled) return "Keine, E-Mails sind aus";
  if (call.dueOn < today) return "Keine verschickt";
  return `Per E-Mail ${REMINDER_LEAD_DAYS} Tage vorher`;
}

/** The last call from the call cards: "vor 2 Tagen, nicht erreicht", or null. */
export function lastCallText(call: RetreatmentCall): string | null {
  if (!call.lastCallAt) return null;
  const when = formatRelative(call.lastCallAt);
  if (call.lastCallOutcome === "termin_vereinbart") return `${when}, Termin vereinbart`;
  if (call.lastCallOutcome === "nicht_erreicht") return `${when}, nicht erreicht`;
  return when;
}

/** The tag's state in words, for its hover text and screen readers. */
export function tagText(state: RetreatmentTagState, call: RetreatmentCall, today: string): string {
  return `Wiederbehandlung ${tagDetail(state, call, today)}`;
}

/** What follows the word on the tag: "Botox: Seit 29 Tagen fällig". */
export function tagDetail(state: RetreatmentTagState, call: RetreatmentCall, today: string): string {
  if (state === "termin") {
    return call.status === "booked"
      ? `${call.treatmentName}: Termin am ${formatDate(call.bookedFor)}`
      : `${call.treatmentName}: Termin am Telefon vereinbart, noch nicht in der PVS`;
  }
  return `${call.treatmentName}: ${dueText(call, today)}`;
}

/** The list tag's words: the Wiederbehandlung, how many more, and the Anfrage's own status. */
export function listTagText(tag: RetreatmentTag, today: string, anfrageStatus: string): string {
  const more = tag.count > 1 ? `, dazu ${formatNumber(tag.count - 1)} weitere` : "";
  return `${tagText(tag.state, tag.call, today)}${more}. Anfrage: ${anfrageStatus}`;
}
