import type { CallQueueLead } from "@/server/queries/requests";
import type { RetreatmentCall } from "@/server/queries/retreatments";

/** One call of the call cards: an Anfrage, or a due Wiederbehandlung. */
export type CallItem =
  | { kind: "anfrage"; key: string; lead: CallQueueLead }
  | { kind: "wiederbehandlung"; key: string; call: RetreatmentCall };

/**
 * One queue for "Jetzt anrufen" and "Als Nächstes" (Karam, 2026-10-29:
 * Wiederbehandlungen among the calls instead of a card of their own).
 * Anfragen with a due Wiedervorlage or without any contact attempt come
 * first: they go cold within hours. Then the due Wiederbehandlungen nobody
 * has called yet, which have days. Then the Anfragen already worked, and
 * last the Wiederbehandlungen not reached. Each input keeps its own order
 * (nextCallQueueLeads, retreatmentCallQueue).
 *
 * A day full of new Anfragen must not bury the Wiederbehandlungen (the old
 * card was always in sight): while one is due, the last place is always one.
 */
export function mergeCallItems(
  leads: CallQueueLead[],
  calls: RetreatmentCall[],
  now: Date,
  limit = 6
): CallItem[] {
  const urgent = (l: CallQueueLead) =>
    l.firstAttemptAt === null || (!!l.nextFollowupAt && l.nextFollowupAt.getTime() <= now.getTime());
  const anfrage = (lead: CallQueueLead): CallItem => ({ kind: "anfrage", key: `a-${lead.id}`, lead });
  const retreatment = (call: RetreatmentCall): CallItem => ({
    kind: "wiederbehandlung",
    key: `w-${call.id}`,
    call,
  });
  const items = [
    ...leads.filter(urgent).map(anfrage),
    ...calls.filter((c) => !c.lastCallAt).map(retreatment),
    ...leads.filter((l) => !urgent(l)).map(anfrage),
    ...calls.filter((c) => !!c.lastCallAt).map(retreatment),
  ].slice(0, limit);
  if (calls[0] && items.length === limit && !items.some((i) => i.kind === "wiederbehandlung")) {
    items[limit - 1] = retreatment(calls[0]);
  }
  return items;
}
