import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  berlinDay,
  computePvsIntervals,
  daysBetween,
  deriveCycleRows,
  groupCycles,
  intervalLabel,
  reminderDecision,
  resolveInterval,
  sinceLastVisitPhrase,
  summarizeForecast,
  summarizeReminders,
  type TreatmentVisit,
} from "./retreatment";

describe("day arithmetic", () => {
  it("adds days across month and DST boundaries", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(addDays("2026-01-10", -14)).toBe("2025-12-27");
  });

  it("clamps calendar months to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-05-15", -6)).toBe("2025-11-15");
  });

  it("counts whole days between two dates", () => {
    expect(daysBetween("2026-01-01", "2026-04-01")).toBe(90);
    expect(daysBetween("2026-04-01", "2026-01-01")).toBe(-90);
  });

  it("uses the Berlin calendar day for late-evening UTC timestamps", () => {
    // 22:30 UTC in summer is 00:30 the next day in Berlin.
    expect(berlinDay(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
    expect(berlinDay(new Date("2026-01-14T22:30:00Z"))).toBe("2026-01-14");
  });

  it("rejects malformed days instead of producing NaN dates", () => {
    expect(() => addDays("14.07.2026", 1)).toThrow();
  });
});

describe("groupCycles", () => {
  it("folds a touch-up within 30 days into the same cycle", () => {
    const cycles = groupCycles([
      { day: "2026-01-10" },
      { day: "2026-01-24" }, // touch-up
      { day: "2026-05-02" },
      { day: "2026-02-09" }, // exactly 30 days after 01-10: still the same cycle
    ]);
    expect(cycles.map((c) => c.start)).toEqual(["2026-01-10", "2026-05-02"]);
    expect(cycles[0].visits).toHaveLength(3);
  });

  it("starts a new cycle on day 31", () => {
    const cycles = groupCycles([{ day: "2026-01-10" }, { day: "2026-02-10" }]);
    expect(cycles.map((c) => c.start)).toEqual(["2026-01-10", "2026-02-10"]);
  });
});

function series(patientKey: string, treatmentId: string, start: string, gapDays: number, n: number): TreatmentVisit[] {
  return Array.from({ length: n }, (_, i) => ({
    patientKey,
    treatmentId,
    day: addDays(start, i * gapDays),
  }));
}

describe("computePvsIntervals", () => {
  it("returns the median gap once there are 5 gaps from 3 patients", () => {
    const visits = [
      ...series("p1", "botox", "2024-01-01", 100, 3), // 2 gaps of 100
      ...series("p2", "botox", "2024-02-01", 120, 3), // 2 gaps of 120
      ...series("p3", "botox", "2024-03-01", 110, 2), // 1 gap of 110
    ];
    const r = computePvsIntervals(visits).get("botox")!;
    expect(r).toEqual({ intervalDays: 110, samples: 5, patients: 3 });
  });

  it("refuses an interval with too few patients, however many gaps", () => {
    const visits = [
      ...series("p1", "botox", "2024-01-01", 100, 6),
      ...series("p2", "botox", "2024-01-01", 100, 2),
    ];
    const r = computePvsIntervals(visits).get("botox")!;
    expect(r.intervalDays).toBeNull();
    expect(r.samples).toBe(6);
    expect(r.patients).toBe(2);
  });

  it("ignores touch-ups and gaps over three years", () => {
    const visits: TreatmentVisit[] = [
      ...series("p1", "filler", "2020-01-01", 180, 2),
      { patientKey: "p1", treatmentId: "filler", day: "2020-01-15" }, // touch-up
      { patientKey: "p1", treatmentId: "filler", day: "2024-06-01" }, // 4-year gap: dropped
      ...series("p2", "filler", "2022-01-01", 180, 3),
      ...series("p3", "filler", "2022-01-01", 200, 2),
    ];
    const r = computePvsIntervals(visits).get("filler")!;
    // gaps: p1 [180], p2 [180, 180], p3 [200] => 4 gaps, below MIN_GAPS
    expect(r.samples).toBe(4);
    expect(r.intervalDays).toBeNull();
  });

  it("keeps treatments apart", () => {
    const visits = [
      ...series("p1", "a", "2024-01-01", 90, 3),
      ...series("p1", "b", "2024-01-05", 365, 2),
    ];
    const m = computePvsIntervals(visits);
    expect(m.get("a")!.samples).toBe(2);
    expect(m.get("b")!.samples).toBe(1);
  });
});

describe("resolveInterval", () => {
  it("prefers the Praxis setting in fixed mode", () => {
    expect(resolveInterval({ mode: "fixed", intervalMonths: 4, pvsIntervalDays: 100 })).toEqual({
      source: "fixed",
      months: 4,
    });
  });

  it("uses the PVS median in auto mode and nothing without one", () => {
    expect(resolveInterval({ mode: "auto", intervalMonths: 4, pvsIntervalDays: 100 })).toEqual({
      source: "pvs",
      days: 100,
    });
    expect(resolveInterval({ mode: "auto", intervalMonths: null, pvsIntervalDays: null })).toBeNull();
  });

  it("keeps switched-off treatments out of the calendar", () => {
    expect(resolveInterval({ mode: "off", intervalMonths: 4, pvsIntervalDays: 100 })).toBeNull();
  });
});

describe("deriveCycleRows", () => {
  const interval = { source: "pvs" as const, days: 100 };

  it("marks older cycles returned and the last one open with due and remind dates", () => {
    const rows = deriveCycleRows({
      treatmentId: "botox",
      cycles: [
        { start: "2026-01-10", revenueCents: 35_000 },
        { start: "2026-04-20", revenueCents: 38_000 },
      ],
      interval,
      upcoming: [],
      today: "2026-06-01",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      cycleOn: "2026-01-10",
      status: "returned",
      returnedOn: "2026-04-20",
      returnedRevenueCents: 38_000,
      reminderStatus: "not_needed",
    });
    expect(rows[1]).toMatchObject({
      cycleOn: "2026-04-20",
      status: "open",
      dueOn: "2026-07-29",
      remindOn: "2026-07-15",
      intervalDays: 100,
      intervalSource: "pvs",
      cycleRevenueCents: 38_000,
      reminderStatus: "pending",
    });
  });

  it("is booked when a later appointment for the same or an unknown treatment exists", () => {
    const base = {
      treatmentId: "botox",
      cycles: [{ start: "2026-04-20", revenueCents: null }],
      interval,
      today: "2026-06-01",
    };
    expect(
      deriveCycleRows({ ...base, upcoming: [{ day: "2026-07-30", treatmentId: "botox" }] })[0]
    ).toMatchObject({ status: "booked", bookedFor: "2026-07-30" });
    expect(
      deriveCycleRows({ ...base, upcoming: [{ day: "2026-07-30", treatmentId: null }] })[0]
    ).toMatchObject({ status: "booked" });
    // Another treatment's appointment does not count.
    expect(
      deriveCycleRows({ ...base, upcoming: [{ day: "2026-07-30", treatmentId: "filler" }] })[0]
    ).toMatchObject({ status: "open", bookedFor: null });
  });

  it("ignores touch-up appointments and past appointments when deciding booked", () => {
    const rows = deriveCycleRows({
      treatmentId: "botox",
      cycles: [{ start: "2026-05-20", revenueCents: null }],
      interval,
      upcoming: [
        { day: "2026-06-05", treatmentId: "botox" }, // touch-up window
        { day: "2026-05-30", treatmentId: "botox" }, // already past
      ],
      today: "2026-06-01",
    });
    expect(rows[0].status).toBe("open");
  });

  it("adds calendar months for a fixed interval", () => {
    const rows = deriveCycleRows({
      treatmentId: "botox",
      cycles: [{ start: "2026-01-31", revenueCents: null }],
      interval: { source: "fixed", months: 1 },
      upcoming: [],
      today: "2026-02-01",
    });
    expect(rows[0]).toMatchObject({ dueOn: "2026-02-28", intervalDays: 28, intervalSource: "fixed" });
  });
});

describe("reminderDecision", () => {
  const base = {
    dueOn: "2026-07-29",
    today: "2026-07-15",
    email: "anna@example.de",
    suppressed: false,
    hasBookingPath: true,
    lastReminderDay: null,
  };

  it("sends in the normal case", () => {
    expect(reminderDecision(base)).toEqual({ action: "send" });
  });

  it("skips rows overdue by more than 60 days", () => {
    expect(reminderDecision({ ...base, dueOn: "2026-05-01" })).toEqual({
      action: "skip",
      reason: "too_old",
    });
    expect(reminderDecision({ ...base, dueOn: "2026-05-16" })).toEqual({ action: "send" });
  });

  it("skips without email, after unsubscribe, and within the cooldown", () => {
    expect(reminderDecision({ ...base, email: null })).toMatchObject({ reason: "no_email" });
    expect(reminderDecision({ ...base, suppressed: true })).toMatchObject({ reason: "unsubscribed" });
    expect(reminderDecision({ ...base, lastReminderDay: "2026-07-01" })).toMatchObject({
      reason: "recently_reminded",
    });
    expect(reminderDecision({ ...base, lastReminderDay: "2026-06-01" })).toEqual({ action: "send" });
  });

  it("waits while the Praxis has no booking link or phone", () => {
    expect(reminderDecision({ ...base, hasBookingPath: false })).toEqual({ action: "wait" });
  });
});

describe("copy helpers", () => {
  it("phrases time since the last visit", () => {
    expect(sinceLastVisitPhrase("2026-04-20", "2026-07-15")).toBe("etwa 3 Monate");
    expect(sinceLastVisitPhrase("2026-06-01", "2026-07-15")).toBe("etwa 6 Wochen");
  });

  it("labels intervals for the Praxis", () => {
    expect(intervalLabel(110)).toBe("ca. 4 Monate");
    expect(intervalLabel(42)).toBe("ca. 6 Wochen");
  });

  it("never emits an em-dash", () => {
    for (const s of [sinceLastVisitPhrase("2026-01-01", "2026-07-01"), intervalLabel(200)]) {
      expect(s).not.toContain("—");
    }
  });
});

describe("summaries", () => {
  const today = "2026-07-01";

  it("forecasts the next 90 days by distinct patient and known value", () => {
    const s = summarizeForecast(
      [
        { patientId: "a", status: "open", dueOn: "2026-07-20", cycleRevenueCents: 35_000, reminderSentAt: null, returnedOn: null },
        { patientId: "a", status: "open", dueOn: "2026-08-20", cycleRevenueCents: 50_000, reminderSentAt: null, returnedOn: null },
        { patientId: "b", status: "booked", dueOn: "2026-09-01", cycleRevenueCents: null, reminderSentAt: null, returnedOn: null },
        { patientId: "c", status: "open", dueOn: "2026-12-01", cycleRevenueCents: 10_000, reminderSentAt: null, returnedOn: null },
        { patientId: "d", status: "open", dueOn: "2026-06-01", cycleRevenueCents: 10_000, reminderSentAt: null, returnedOn: null },
        { patientId: "e", status: "returned", dueOn: "2026-07-10", cycleRevenueCents: 10_000, reminderSentAt: null, returnedOn: "2026-06-20" },
      ],
      today
    );
    expect(s).toEqual({
      duePatients: 2,
      dueRows: 3,
      dueValueCents: 85_000,
      dueRowsWithoutValue: 1,
      overduePatients: 1,
    });
  });

  it("counts reminders this month and returns after a reminder", () => {
    const monthStart = "2026-07-01";
    const s = summarizeReminders(
      [
        // reminded this month, booked since
        { patientId: "a", status: "booked", dueOn: "2026-07-20", cycleRevenueCents: null, reminderSentAt: new Date("2026-07-06T08:00:00Z"), returnedOn: null, returnedRevenueCents: null },
        // reminded this month, nothing yet
        { patientId: "b", status: "open", dueOn: "2026-07-25", cycleRevenueCents: null, reminderSentAt: new Date("2026-07-11T08:00:00Z"), returnedOn: null, returnedRevenueCents: null },
        // reminded last month, came back after it
        { patientId: "c", status: "returned", dueOn: "2026-06-20", cycleRevenueCents: null, reminderSentAt: new Date("2026-06-06T08:00:00Z"), returnedOn: "2026-06-18", returnedRevenueCents: 40_000 },
        // came back BEFORE the reminder date: not counted as after-reminder
        { patientId: "d", status: "returned", dueOn: "2026-06-20", cycleRevenueCents: null, reminderSentAt: new Date("2026-06-10T08:00:00Z"), returnedOn: "2026-06-01", returnedRevenueCents: 40_000 },
        // never reminded
        { patientId: "e", status: "returned", dueOn: "2026-06-20", cycleRevenueCents: null, reminderSentAt: null, returnedOn: "2026-06-25", returnedRevenueCents: 40_000 },
      ],
      monthStart
    );
    expect(s).toEqual({
      remindedThisMonth: 2,
      bookedThisMonth: 1,
      remindedTotal: 4,
      returnedAfterReminder: 1,
      returnedAfterReminderCents: 40_000,
    });
  });
});
