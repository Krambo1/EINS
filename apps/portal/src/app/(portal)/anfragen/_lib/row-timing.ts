import {
  isPraxisResponseFlag,
  responseInfo,
  type ResponseInput,
} from "@/lib/response-time";

/**
 * The one timing line an Anfrage row shows under its name. Lists, the call
 * queue and the hero card all read it from here, so the same inquiry never
 * says "Kontaktieren bis Fr." and "Überfällig" at once.
 *
 *   deadline  the 48-Werkstunden-Frist (KANON 6a) still runs. `late` marks
 *             that the internal Rückruf-Ziel (SLA_HOURS) has already passed:
 *             same line, shown as urgent, instead of a second marker.
 *   flag      the Frist ran out: "von der Praxis nicht beantwortet" or
 *             "zu spät beantwortet" (Garantie-Anhang § 6 Abs. (5) lit. b).
 *   overdue   no Frist applies (inquiry before the rule start) but the
 *             Rückruf-Ziel passed without a first contact.
 */
export type RowTiming =
  | { kind: "deadline"; deadline: Date; late: boolean }
  | { kind: "flag"; state: "nicht_beantwortet" | "zu_spaet"; deadline: Date | null }
  | { kind: "overdue" };

export interface RowTimingInput extends ResponseInput {
  firstContactedAt: Date | null;
  slaRespondBy: Date | null;
}

/**
 * Statuses that only exist after someone spoke to the person. Changing the
 * status in the portal already logs the contact attempt; this covers rows
 * whose status arrived without one (imports, older data). Display only: the
 * monthly report and Folge 3 still count from the logged attempt.
 */
const CONTACT_IMPLIED_STATUSES = new Set([
  "termin_vereinbart",
  "beratung_erschienen",
  "no_show",
  "behandelt",
  "gewonnen",
]);

export function statusImpliesContact(status: string): boolean {
  return CONTACT_IMPLIED_STATUSES.has(status);
}

export function rowTiming(input: RowTimingInput, now: Date): RowTiming | null {
  if (statusImpliesContact(input.status)) return null;
  const slaBreached =
    !input.firstContactedAt &&
    !!input.slaRespondBy &&
    input.slaRespondBy.getTime() < now.getTime();
  const info = responseInfo(
    {
      createdAt: input.createdAt,
      firstAttemptAt: input.firstAttemptAt,
      status: input.status,
      ruleStart: input.ruleStart,
    },
    now
  );
  if (info.state === "offen" && info.deadline) {
    return { kind: "deadline", deadline: info.deadline, late: slaBreached };
  }
  if (isPraxisResponseFlag(info.state)) {
    return { kind: "flag", state: info.state, deadline: info.deadline };
  }
  if (slaBreached) return { kind: "overdue" };
  return null;
}
