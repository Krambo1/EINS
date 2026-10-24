import { describe, expect, it } from "vitest";
import { rowTiming, type RowTimingInput } from "./row-timing";

// Monday 12.10.2026, 09:00 Berlin (CEST), after the rule start.
const created = new Date("2026-10-12T07:00:00Z");
const twoHoursLater = new Date("2026-10-12T09:00:00Z");

function input(over: Partial<RowTimingInput> = {}): RowTimingInput {
  return {
    createdAt: created,
    firstAttemptAt: null,
    firstContactedAt: null,
    status: "new",
    slaRespondBy: twoHoursLater,
    ...over,
  };
}

describe("rowTiming", () => {
  it("shows the running Frist while the Rückruf-Ziel still holds", () => {
    const t = rowTiming(input(), new Date("2026-10-12T08:00:00Z"));
    expect(t).toMatchObject({ kind: "deadline", late: false });
  });

  it("keeps one deadline line, marked late, once the Rückruf-Ziel passed", () => {
    const t = rowTiming(input(), new Date("2026-10-12T10:00:00Z"));
    expect(t).toMatchObject({ kind: "deadline", late: true });
  });

  it("flags an inquiry the Praxis never answered", () => {
    const t = rowTiming(input(), new Date("2026-11-30T12:00:00Z"));
    expect(t).toMatchObject({ kind: "flag", state: "nicht_beantwortet" });
  });

  it("flags a late first attempt", () => {
    const late = new Date("2026-11-30T12:00:00Z");
    const t = rowTiming(
      input({ firstAttemptAt: late, firstContactedAt: late }),
      new Date("2026-12-01T12:00:00Z")
    );
    expect(t).toMatchObject({ kind: "flag", state: "zu_spaet" });
  });

  it("shows nothing once the Praxis answered in time", () => {
    const soon = new Date("2026-10-12T08:00:00Z");
    expect(
      rowTiming(input({ firstAttemptAt: soon, firstContactedAt: soon }), new Date("2026-10-20T12:00:00Z"))
    ).toBeNull();
  });

  it("shows nothing once the status says the person was reached", () => {
    const late = new Date("2026-11-30T12:00:00Z");
    expect(rowTiming(input({ status: "termin_vereinbart" }), late)).toBeNull();
    expect(rowTiming(input({ status: "gewonnen" }), late)).toBeNull();
  });

  it("keeps the flag for a lost inquiry nobody called", () => {
    const t = rowTiming(input({ status: "verloren" }), new Date("2026-11-30T12:00:00Z"));
    expect(t).toMatchObject({ kind: "flag", state: "nicht_beantwortet" });
  });

  it("falls back to Überfällig for inquiries before the rule start", () => {
    const old = new Date("2026-09-01T07:00:00Z");
    const t = rowTiming(
      input({ createdAt: old, slaRespondBy: new Date("2026-09-01T09:00:00Z") }),
      new Date("2026-10-12T08:00:00Z")
    );
    expect(t).toEqual({ kind: "overdue" });
  });

  it("shows nothing for an old inquiry that was contacted", () => {
    const old = new Date("2026-09-01T07:00:00Z");
    expect(
      rowTiming(
        input({
          createdAt: old,
          slaRespondBy: new Date("2026-09-01T09:00:00Z"),
          firstContactedAt: new Date("2026-09-01T08:00:00Z"),
        }),
        new Date("2026-10-12T08:00:00Z")
      )
    ).toBeNull();
  });
});
