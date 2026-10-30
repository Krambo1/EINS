import { describe, expect, it } from "vitest";
import type { CallQueueLead } from "@/server/queries/requests";
import type { RetreatmentCall } from "@/server/queries/retreatments";
import { mergeCallItems } from "./call-items";

const now = new Date("2026-10-29T10:00:00Z");

function lead(id: string, over: Partial<CallQueueLead> = {}): CallQueueLead {
  return {
    id,
    contactName: id,
    contactPhone: null,
    contactEmail: null,
    treatmentWish: null,
    treatmentName: null,
    source: "landing_page",
    status: "neu",
    message: null,
    quiz: null,
    slaRespondBy: null,
    firstContactedAt: null,
    firstAttemptAt: null,
    createdAt: now,
    nextFollowupAt: null,
    pvsControlled: false,
    ...over,
  };
}

function call(id: string, lastCallAt: Date | null = null): RetreatmentCall {
  return {
    id,
    requestId: null,
    patientName: id,
    patientPhone: null,
    patientEmail: null,
    treatmentName: "Botox",
    cycleOn: "2026-06-01",
    dueOn: "2026-10-01",
    status: "open",
    bookedFor: null,
    returnedOn: null,
    cycleRevenueCents: null,
    reminderStatus: "pending",
    reminderSentAt: null,
    reminderSkipReason: null,
    bookingClickedAt: null,
    requestMessage: null,
    requestCreatedAt: null,
    lastCallAt,
    lastCallOutcome: lastCallAt ? "nicht_erreicht" : null,
  };
}

const keys = (items: ReturnType<typeof mergeCallItems>) => items.map((i) => i.key);

describe("mergeCallItems", () => {
  it("puts fresh Anfragen first, worked ones after the due Wiederbehandlungen", () => {
    const worked = lead("worked", { status: "kontaktiert", firstAttemptAt: new Date("2026-10-28T10:00:00Z") });
    const items = mergeCallItems([lead("fresh"), worked], [call("w1"), call("w2", now)], now);
    expect(keys(items)).toEqual(["a-fresh", "w-w1", "a-worked", "w-w2"]);
  });

  it("treats a due Wiedervorlage as fresh, a later one as worked", () => {
    const touched = { firstAttemptAt: new Date("2026-10-20T10:00:00Z"), status: "kontaktiert" as const };
    const due = lead("due", { ...touched, nextFollowupAt: new Date("2026-10-29T09:00:00Z") });
    const later = lead("later", { ...touched, nextFollowupAt: new Date("2026-10-30T09:00:00Z") });
    const items = mergeCallItems([due, later], [call("w1")], now);
    expect(keys(items)).toEqual(["a-due", "w-w1", "a-later"]);
  });

  it("keeps the limit", () => {
    const leads = Array.from({ length: 5 }, (_, i) => lead(`l${i}`));
    const items = mergeCallItems(leads, [call("w1"), call("w2")], now);
    expect(keys(items)).toEqual(["a-l0", "a-l1", "a-l2", "a-l3", "a-l4", "w-w1"]);
  });

  it("keeps the last place for a due Wiederbehandlung on a busy day", () => {
    const leads = Array.from({ length: 6 }, (_, i) => lead(`l${i}`));
    expect(keys(mergeCallItems(leads, [call("w1", now)], now))).toEqual([
      "a-l0",
      "a-l1",
      "a-l2",
      "a-l3",
      "a-l4",
      "w-w1",
    ]);
    expect(keys(mergeCallItems(leads, [], now))).toEqual(["a-l0", "a-l1", "a-l2", "a-l3", "a-l4", "a-l5"]);
  });
});
