import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinDate,
  checkConfirmable,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  compareByUrgency,
  computeClock,
  computeDeadline,
  confirmBlockReason,
  eligibleInquiries,
  formatIsoDate,
  hasContactData,
  inquiryScanRange,
  isIsoDate,
  noticeInTime,
  verzugRange,
  type ClockInput,
} from "./guarantee-clock";

const SIGNED = "2026-10-01";
const BASE_DEADLINE = "2026-12-30"; // 2026-10-01 + 90 days

function clock(over: Partial<ClockInput>) {
  return computeClock({
    signedOn: SIGNED,
    delays: [],
    confirmedInquiryOn: null,
    manualEnd: null,
    today: SIGNED,
    ...over,
  });
}

describe("date helpers", () => {
  it("adds calendar days across month and DST boundaries", () => {
    expect(addDays(SIGNED, 90)).toBe(BASE_DEADLINE);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("reads timestamps as Berlin calendar dates", () => {
    // 23:30 UTC on 30 Sep is 01:30 on 1 Oct in Berlin (CEST).
    expect(berlinDate(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
  });

  it("validates and formats ISO dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(formatIsoDate("2026-10-01")).toBe("01.10.2026");
    expect(formatIsoDate(null)).toBe("–");
  });
});

describe("verzugRange", () => {
  it("runs from the day after the missed deadline through fulfilment", () => {
    expect(verzugRange("2026-10-06", "2026-10-09")).toEqual({ from: "2026-10-07", to: "2026-10-09" });
  });

  it("is empty when fulfilled on the due date", () => {
    expect(verzugRange("2026-10-06", "2026-10-06")).toBeNull();
  });

  it("stays open until fulfilled", () => {
    expect(verzugRange("2026-10-06", null)).toEqual({ from: "2026-10-07", to: null });
  });
});

describe("computeDeadline", () => {
  it("is signing date + 90 days without delays", () => {
    expect(computeDeadline(SIGNED, [], SIGNED)).toEqual({
      deadline: BASE_DEADLINE,
      delayDays: 0,
      totalDays: 90,
    });
  });

  it("extends by each delay day", () => {
    const r = computeDeadline(SIGNED, [{ from: "2026-10-07", to: "2026-10-09", notifiedOn: SIGNED }], "2026-11-01");
    expect(r.delayDays).toBe(3);
    expect(r.deadline).toBe(addDays(BASE_DEADLINE, 3));
    expect(r.totalDays).toBe(93);
  });

  it("counts overlapping ranges once", () => {
    const r = computeDeadline(
      SIGNED,
      [
        { from: "2026-10-07", to: "2026-10-10", notifiedOn: SIGNED },
        { from: "2026-10-09", to: "2026-10-12", notifiedOn: SIGNED },
        { from: "2026-10-12", to: "2026-10-12", notifiedOn: SIGNED },
      ],
      "2026-11-01"
    );
    expect(r.delayDays).toBe(6); // 7th..12th
  });

  it("counts an open delay through today", () => {
    const r = computeDeadline(SIGNED, [{ from: "2026-10-07", to: null, notifiedOn: SIGNED }], "2026-10-10");
    expect(r.delayDays).toBe(4);
  });

  it("ignores days on or before signing and days not reached yet", () => {
    const r = computeDeadline(SIGNED, [{ from: "2026-09-20", to: "2026-10-20", notifiedOn: SIGNED }], "2026-10-05");
    expect(r.delayDays).toBe(4); // 2nd..5th
  });

  it("ignores a delay that starts after the deadline had passed", () => {
    const r = computeDeadline(SIGNED, [{ from: "2027-01-05", to: "2027-01-10", notifiedOn: SIGNED }], "2027-02-01");
    expect(r.delayDays).toBe(0);
  });

  it("counts a delay that starts inside the extended deadline", () => {
    const r = computeDeadline(
      SIGNED,
      [
        { from: "2026-10-02", to: "2026-10-11", notifiedOn: SIGNED }, // 10 days -> deadline 2027-01-09
        { from: "2027-01-05", to: "2027-01-06", notifiedOn: SIGNED }, // after base deadline, inside extended one
      ],
      "2027-02-01"
    );
    expect(r.delayDays).toBe(12);
    expect(r.deadline).toBe(addDays(BASE_DEADLINE, 12));
  });
});

describe("computeDeadline: only notified delays count", () => {
  const range = { from: "2026-10-07", to: "2026-10-09" };

  it("ignores a delay that was never notified", () => {
    const r = computeDeadline(SIGNED, [{ ...range, notifiedOn: null }], "2026-11-01");
    expect(r).toMatchObject({ delayDays: 0, deadline: BASE_DEADLINE });
  });

  it("ignores a delay notified after the as-of date, counts it from then on", () => {
    const delays = [{ ...range, notifiedOn: "2026-10-20" }];
    expect(computeDeadline(SIGNED, delays, "2026-10-19").delayDays).toBe(0);
    expect(computeDeadline(SIGNED, delays, "2026-10-20").delayDays).toBe(3);
  });

  it("applies the same rule to platform disruptions and still merges overlaps", () => {
    const r = computeDeadline(
      SIGNED,
      [
        { from: "2026-10-07", to: "2026-10-10", notifiedOn: "2026-10-08" },
        { from: "2026-10-09", to: "2026-10-12", notifiedOn: null },
      ],
      "2026-11-01"
    );
    expect(r.delayDays).toBe(4);
  });

  it("keeps a clock ended when the only delay is unnotified", () => {
    const today = addDays(BASE_DEADLINE, 2);
    const c = computeClock({
      signedOn: SIGNED,
      delays: [{ from: "2026-10-10", to: "2026-10-14", notifiedOn: null }],
      confirmedInquiryOn: null,
      manualEnd: null,
      today,
    });
    expect(c.status).toBe("beendet_ohne_anfrage");
  });
});

describe("computeClock", () => {
  it("has no deadline without a signing date", () => {
    const c = clock({ signedOn: null });
    expect(c.status).toBe("ohne_startdatum");
    expect(c.deadline).toBeNull();
  });

  it("shows day 0 of 90 on the signing day", () => {
    expect(clock({})).toMatchObject({ status: "laeuft", dayNumber: 0, totalDays: 90, daysLeft: 90 });
  });

  it("shows day X of N and days left while running", () => {
    const c = clock({ today: "2026-10-31", delays: [{ from: "2026-10-07", to: "2026-10-08", notifiedOn: SIGNED }] });
    expect(c).toMatchObject({ status: "laeuft", dayNumber: 30, totalDays: 92, daysLeft: 62 });
  });

  it("is still running on the last day", () => {
    expect(clock({ today: BASE_DEADLINE })).toMatchObject({ status: "laeuft", daysLeft: 0, dayNumber: 90 });
  });

  it("ends without inquiry the day after the deadline", () => {
    expect(clock({ today: addDays(BASE_DEADLINE, 1) })).toMatchObject({
      status: "beendet_ohne_anfrage",
      daysLeft: 0,
      dayNumber: 90,
    });
  });

  it("extends with a delay notified inside the window", () => {
    const today = addDays(BASE_DEADLINE, 2);
    expect(clock({ today }).status).toBe("beendet_ohne_anfrage");
    const c = clock({ today, delays: [{ from: "2026-10-10", to: "2026-10-14", notifiedOn: SIGNED }] });
    expect(c).toMatchObject({ status: "laeuft", daysLeft: 3, totalDays: 95 });
  });

  // K-1: a notice after the deadline never revives an ended clock.
  it("does not revive when the delay is only notified after the deadline passed", () => {
    const today = addDays(BASE_DEADLINE, 2);
    const c = clock({ today, delays: [{ from: "2026-10-10", to: "2026-10-14", notifiedOn: today }] });
    expect(c).toMatchObject({ status: "beendet_ohne_anfrage", delayDays: 0, totalDays: 90 });
  });

  it("sets Rechnung fällig only through a confirmed inquiry and freezes the clock", () => {
    const c = clock({ today: "2027-03-01", confirmedInquiryOn: "2026-11-15" });
    expect(c.status).toBe("rechnung_faellig");
    expect(c.dayNumber).toBe(45);
  });

  it("keeps a manual end state", () => {
    const c = clock({
      today: "2026-11-20",
      manualEnd: { state: "beendet_durch_praxis", on: "2026-11-01" },
    });
    expect(c.status).toBe("beendet_durch_praxis");
    expect(c.dayNumber).toBe(31);
  });
});

describe("checkConfirmable", () => {
  const base = { signedOn: SIGNED, delays: [], manualEnd: null, today: "2027-01-02" };

  it("accepts an inquiry on the last day, confirmed after the deadline", () => {
    expect(checkConfirmable(base, BASE_DEADLINE)).toEqual({ ok: true });
  });

  it("accepts an inquiry on the signing day", () => {
    expect(checkConfirmable(base, SIGNED).ok).toBe(true);
  });

  it("rejects inquiries before signing or after the deadline", () => {
    expect(checkConfirmable(base, "2026-09-30").ok).toBe(false);
    expect(checkConfirmable(base, addDays(BASE_DEADLINE, 1)).ok).toBe(false);
    expect(checkConfirmable({ ...base, signedOn: null }, SIGNED).ok).toBe(false);
  });

  it("rejects every inquiry while a manual end is set (before, on and after the end day)", () => {
    const ended = { ...base, manualEnd: { state: "beendet_durch_praxis" as const, on: "2026-11-01" } };
    for (const inquiryOn of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      const result = checkConfirmable(ended, inquiryOn);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/manuell beendet/);
    }
  });
});

describe("inquiryScanRange", () => {
  it("covers the whole Berlin day range with slack for the UTC offset", () => {
    const { from, before } = inquiryScanRange(SIGNED, BASE_DEADLINE);
    // 00:30 Berlin (CEST) on the signing day = 22:30 UTC the day before.
    const earliest = new Date("2026-09-30T22:30:00Z");
    expect(berlinDate(earliest)).toBe(SIGNED);
    expect(earliest.getTime()).toBeGreaterThanOrEqual(from.getTime());
    // 23:30 Berlin (CET) on the deadline day = 22:30 UTC the same day.
    const latest = new Date("2026-12-30T22:30:00Z");
    expect(berlinDate(latest)).toBe(BASE_DEADLINE);
    expect(latest.getTime()).toBeLessThan(before.getTime());
  });
});

describe("eligibleInquiries", () => {
  const rows = [
    { id: "late", createdAt: new Date("2026-10-20T10:00:00Z"), source: "formular", utm: null },
    { id: "manual", createdAt: new Date("2026-10-03T10:00:00Z"), source: "manuell", utm: null },
    { id: "before", createdAt: new Date("2026-09-29T10:00:00Z"), source: "formular", utm: null },
    { id: "early", createdAt: new Date("2026-10-05T10:00:00Z"), source: "formular", utm: { utm_medium: "dm", utm_source: "instagram" } },
    { id: "meta", createdAt: new Date("2026-10-04T10:00:00Z"), source: "meta", utm: null },
    { id: "after", createdAt: new Date("2027-01-02T10:00:00Z"), source: "anruf", utm: null },
  ];
  const window = { signedOn: SIGNED, deadline: BASE_DEADLINE, rejectedIds: new Set<string>() };

  it("proposes the earliest Messweg inquiry inside the window", () => {
    const list = eligibleInquiries(rows, window);
    expect(list.map((e) => e.row.id)).toEqual(["early", "late"]);
    expect(list[0]!.attribution.channel).toBe("dm_link");
    expect(list[0]!.inquiryOn).toBe("2026-10-05");
  });

  it("skips rejected inquiries so the next one becomes the candidate", () => {
    const list = eligibleInquiries(rows, { ...window, rejectedIds: new Set(["early"]) });
    expect(list[0]!.row.id).toBe("late");
  });
});

describe("compareByUrgency", () => {
  it("puts running clocks with fewest days left first", () => {
    const list = [
      { status: "rechnung_faellig" as const, daysLeft: 0 },
      { status: "laeuft" as const, daysLeft: 40 },
      { status: "ohne_startdatum" as const, daysLeft: 90 },
      { status: "laeuft" as const, daysLeft: 3 },
    ].sort(compareByUrgency);
    expect(list.map((c) => `${c.status}:${c.daysLeft}`)).toEqual([
      "laeuft:3",
      "laeuft:40",
      "ohne_startdatum:90",
      "rechnung_faellig:0",
    ]);
  });
});

// ---------------------------------------------------------------------------
// K-1: notice after the deadline (portal review, findings K-garantie)
// ---------------------------------------------------------------------------

describe("computeDeadline: notice must reach the Praxis before the deadline (K-1)", () => {
  const signed = "2026-01-05"; // base deadline 2026-04-05
  const range = { from: "2026-01-09", to: "2026-01-20" }; // 12 days

  it("ignores a notice five days after the deadline and keeps the clock ended", () => {
    const delays = [{ ...range, notifiedOn: "2026-04-10" }];
    expect(computeDeadline(signed, delays, "2026-04-10")).toMatchObject({ deadline: "2026-04-05", delayDays: 0 });
    const c = computeClock({ signedOn: signed, delays, confirmedInquiryOn: null, manualEnd: null, today: "2026-04-10" });
    expect(c.status).toBe("beendet_ohne_anfrage");
    expect(checkConfirmable({ signedOn: signed, delays, manualEnd: null, today: "2026-04-10" }, "2026-04-08").ok).toBe(false);
  });

  it("counts a notice sent on the deadline day itself", () => {
    const delays = [{ ...range, notifiedOn: "2026-04-05" }];
    expect(computeDeadline(signed, delays, "2026-04-10")).toMatchObject({ deadline: "2026-04-17", delayDays: 12 });
    expect(noticeInTime(signed, [], "2026-04-05")).toBe(true);
    expect(noticeInTime(signed, [], "2026-04-06")).toBe(false);
  });

  it("lets an earlier notice extend the deadline so a later one is still in time", () => {
    const delays = [
      { from: "2026-01-09", to: "2026-01-20", notifiedOn: "2026-01-21" }, // deadline -> 2026-04-17
      { from: "2026-02-01", to: "2026-02-03", notifiedOn: "2026-04-15" }, // after base, before extended deadline
    ];
    expect(computeDeadline(signed, delays, "2026-05-01")).toMatchObject({ deadline: "2026-04-20", delayDays: 15 });
  });

  it("drops a second delay notified after the extended deadline, keeps the first", () => {
    const delays = [
      { from: "2026-01-09", to: "2026-01-20", notifiedOn: "2026-01-21" }, // deadline -> 2026-04-17
      { from: "2026-02-01", to: "2026-02-03", notifiedOn: "2026-04-18" }, // one day too late
    ];
    expect(computeDeadline(signed, delays, "2026-05-01")).toMatchObject({ deadline: "2026-04-17", delayDays: 12 });
    expect(noticeInTime(signed, delays.slice(0, 1), "2026-04-17")).toBe(true);
    expect(noticeInTime(signed, delays.slice(0, 1), "2026-04-18")).toBe(false);
  });

  it("keeps an open, notified delay running without a cap (documents K-13)", () => {
    const delays = [{ from: "2026-01-09", to: null, notifiedOn: "2026-01-12" }];
    const today = addDays("2026-01-09", 400);
    const c = computeClock({ signedOn: signed, delays, confirmedInquiryOn: null, manualEnd: null, today });
    expect(c.status).toBe("laeuft");
    expect(c.delayDays).toBe(401);
  });
});

describe("verzugRange edges", () => {
  it("has no day when fulfilled on the due date, one day when fulfilled the next day", () => {
    expect(verzugRange("2026-10-30", "2026-10-30")).toBeNull();
    expect(verzugRange("2026-10-30", "2026-10-31")).toEqual({ from: "2026-10-31", to: "2026-10-31" });
  });
});

// ---------------------------------------------------------------------------
// DST: the deadline 2026-10-25 is the 25-hour day of the autumn change
// ---------------------------------------------------------------------------

describe("DST change on 2026-10-25", () => {
  const signed = "2026-07-27";

  it("puts the deadline on the 25-hour day and ends the day after", () => {
    expect(computeDeadline(signed, [], signed).deadline).toBe("2026-10-25");
    const run = (today: string) =>
      computeClock({ signedOn: signed, delays: [], confirmedInquiryOn: null, manualEnd: null, today });
    expect(run("2026-10-25")).toMatchObject({ status: "laeuft", daysLeft: 0, dayNumber: 90 });
    expect(run("2026-10-26")).toMatchObject({ status: "beendet_ohne_anfrage", daysLeft: 0 });
  });

  it("reads both 02:30 of the doubled hour as 25.10.", () => {
    expect(berlinDate(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    expect(berlinDate(new Date("2026-10-25T01:30:00Z"))).toBe("2026-10-25");
    expect(berlinDate(new Date("2026-03-29T00:59:59Z"))).toBe("2026-03-29");
    expect(berlinDate(new Date("2026-03-29T01:00:00Z"))).toBe("2026-03-29");
  });

  it("takes inquiries by Berlin day around the deadline", () => {
    const rows = [
      { id: "end", createdAt: new Date("2026-10-25T22:59:59Z"), source: "formular", utm: null }, // 23:59:59 CET
      { id: "start", createdAt: new Date("2026-10-24T22:00:00Z"), source: "formular", utm: null }, // 00:00 CEST
      { id: "after", createdAt: new Date("2026-10-25T23:00:00Z"), source: "formular", utm: null }, // 26.10. 00:00 CET
      { id: "before", createdAt: new Date("2026-10-24T21:59:59Z"), source: "formular", utm: null }, // 24.10.
    ];
    const list = eligibleInquiries(rows, { signedOn: signed, deadline: "2026-10-25", rejectedIds: new Set() });
    expect(list.map((e) => e.row.id)).toEqual(["before", "start", "end"]);
    expect(list.map((e) => e.inquiryOn)).toEqual(["2026-10-24", "2026-10-25", "2026-10-25"]);
  });

  it("scan range covers the Berlin day edges", () => {
    const { from, before } = inquiryScanRange(signed, "2026-10-25");
    expect(new Date("2026-10-25T22:59:59Z").getTime()).toBeLessThan(before.getTime());
    expect(new Date("2026-07-26T23:30:00Z").getTime()).toBeGreaterThanOrEqual(from.getTime());
  });

  it("confirms an inquiry on the deadline day the day after, not one from 26.10.", () => {
    const input = { signedOn: signed, delays: [], manualEnd: null, today: "2026-10-26" };
    expect(checkConfirmable(input, "2026-10-25")).toEqual({ ok: true });
    expect(checkConfirmable(input, berlinDate(new Date("2026-10-25T23:00:00Z"))).ok).toBe(false);
  });

  it("spring: signing on 28.03. starts at Berlin midnight (CET)", () => {
    expect(computeDeadline("2026-03-28", [], "2026-03-28").deadline).toBe("2026-06-26");
    const rows = [
      { id: "prev", createdAt: new Date("2026-03-27T22:59:59Z"), source: "formular", utm: null },
      { id: "first", createdAt: new Date("2026-03-27T23:00:00Z"), source: "formular", utm: null },
    ];
    const list = eligibleInquiries(rows, { signedOn: "2026-03-28", deadline: "2026-06-26", rejectedIds: new Set() });
    expect(list.map((e) => e.row.id)).toEqual(["first"]);
  });
});

// ---------------------------------------------------------------------------
// K-2 / K-3: what may be confirmed
// ---------------------------------------------------------------------------

describe("confirm checks (K-2)", () => {
  const rows = [
    { id: "nocontact", createdAt: new Date("2026-10-03T10:00:00Z"), source: "formular", utm: null, contactEmail: " ", contactPhone: null, status: "neu" },
    { id: "spam", createdAt: new Date("2026-10-04T10:00:00Z"), source: "formular", utm: null, contactEmail: "a@b.de", contactPhone: null, status: "spam" },
    { id: "ok", createdAt: new Date("2026-10-05T10:00:00Z"), source: "formular", utm: null, contactEmail: null, contactPhone: "0221 1", status: "neu" },
  ];
  const list = eligibleInquiries(rows, { signedOn: SIGNED, deadline: BASE_DEADLINE, rejectedIds: new Set() });

  it("reports contact data and spam marking instead of hiding them", () => {
    expect(list.map((e) => [e.row.id, e.hasContactData, e.isSpamMarked])).toEqual([
      ["nocontact", false, false],
      ["spam", true, true],
      ["ok", true, false],
    ]);
  });

  it("blocks without contact data, with spam status, and while an earlier candidate is open", () => {
    const none = { earlierOpen: false, skipEarlier: false };
    expect(confirmBlockReason(list[0]!, none)).toMatch(/weder Telefon noch E-Mail/);
    expect(confirmBlockReason(list[1]!, none)).toMatch(/als Spam markiert/);
    expect(confirmBlockReason(list[2]!, { earlierOpen: true, skipEarlier: false })).toMatch(/frühere mögliche Anfrage/);
    expect(confirmBlockReason(list[2]!, { earlierOpen: true, skipEarlier: true })).toBeNull();
    expect(confirmBlockReason(list[2]!, none)).toBeNull();
  });

  it("counts a phone or an e-mail after trimming", () => {
    expect(hasContactData({ contactEmail: "  ", contactPhone: "" })).toBe(false);
    expect(hasContactData({ contactEmail: "x@y.de", contactPhone: null })).toBe(true);
  });
});

describe("before signing (K-3)", () => {
  it("never proposes an inquiry from before Berlin midnight of the signing day", () => {
    // 30.09. 23:59 CEST = 21:59Z, signing 01.10.
    const rows = [
      { id: "test", createdAt: new Date("2026-09-30T21:59:00Z"), source: "formular", utm: null },
      { id: "real", createdAt: new Date("2026-09-30T22:00:00Z"), source: "formular", utm: null },
    ];
    const list = eligibleInquiries(rows, { signedOn: SIGNED, deadline: BASE_DEADLINE, rejectedIds: new Set() });
    expect(list.map((e) => e.row.id)).toEqual(["real"]);
  });

  it("has a test-entry rejection reason", () => {
    expect(REJECTION_REASONS).toContain("test_eintrag");
    expect(REJECTION_REASON_LABELS.test_eintrag).toBe("Test der EINS-Seite, keine echte Person");
  });
});
