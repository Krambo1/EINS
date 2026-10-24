import { describe, expect, it } from "vitest";
import {
  addWorkingHours,
  easterSunday,
  endOfNextWerktag,
  formatBerlinDateTime,
  isAnyStatutoryHoliday,
  isNrwHoliday,
  isWerktag,
  nextWerktag,
  responseDeadline,
} from "./werkstunden";

/** Berlin wall time "YYYY-MM-DD HH:MM" in CEST/CET via an explicit offset. */
const at = (iso: string) => new Date(iso);

describe("easterSunday", () => {
  it("matches known dates", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });
});

describe("holiday calendars", () => {
  it("union covers nationwide and regional holidays", () => {
    for (const d of [
      "2026-01-01",
      "2026-01-06",
      "2026-03-08" /* Sunday in 2026, still listed */,
      "2026-04-03",
      "2026-04-06",
      "2026-05-01",
      "2026-05-14",
      "2026-05-25",
      "2026-06-04",
      "2026-08-08",
      "2026-08-15",
      "2026-09-20",
      "2026-10-03",
      "2026-10-31",
      "2026-11-01",
      "2026-11-18",
      "2026-12-25",
      "2026-12-26",
    ]) {
      expect(isAnyStatutoryHoliday(d), d).toBe(true);
    }
    expect(isAnyStatutoryHoliday("2026-12-24")).toBe(false);
    expect(isAnyStatutoryHoliday("2026-12-31")).toBe(false);
  });

  it("NRW has Fronleichnam and Allerheiligen but not Buß- und Bettag or Reformationstag", () => {
    expect(isNrwHoliday("2026-06-04")).toBe(true);
    expect(isNrwHoliday("2026-11-01")).toBe(true);
    expect(isNrwHoliday("2026-11-18")).toBe(false);
    expect(isNrwHoliday("2026-10-31")).toBe(false);
    expect(isNrwHoliday("2026-01-06")).toBe(false);
  });
});

describe("responseDeadline (48 Werkstunden)", () => {
  it("Monday 10:00 ends the following Monday 13:00 (contract example)", () => {
    expect(responseDeadline(at("2026-10-12T10:00:00+02:00"))).toEqual(at("2026-10-19T13:00:00+02:00"));
  });

  it("Friday 17:00: one hour on Friday, the rest the week after", () => {
    expect(responseDeadline(at("2026-10-09T17:00:00+02:00"))).toEqual(at("2026-10-19T11:00:00+02:00"));
  });

  it("weekend arrival starts Monday 09:00", () => {
    expect(responseDeadline(at("2026-10-10T15:00:00+02:00"))).toEqual(at("2026-10-19T12:00:00+02:00"));
  });

  it("07:00 arrival starts at 09:00 the same day", () => {
    expect(responseDeadline(at("2026-10-12T07:00:00+02:00"))).toEqual(at("2026-10-19T12:00:00+02:00"));
  });

  it("18:30 arrival starts at 09:00 the next working day", () => {
    expect(responseDeadline(at("2026-10-12T18:30:00+02:00"))).toEqual(at("2026-10-20T12:00:00+02:00"));
  });

  it("an arrival at exactly 18:00 counts as after hours", () => {
    expect(responseDeadline(at("2026-10-12T18:00:00+02:00"))).toEqual(at("2026-10-20T12:00:00+02:00"));
  });

  it("a deadline that lands on 18:00 stays on that day", () => {
    // Mon 09:00 + 45 h = Fri 18:00.
    expect(addWorkingHours(at("2026-10-12T09:00:00+02:00"), 45)).toEqual(at("2026-10-16T18:00:00+02:00"));
  });

  it("skips Karfreitag and Ostermontag, across the spring DST switch", () => {
    // Fri 27.03.2026 10:00 CET; clocks go forward on Sun 29.03.
    expect(responseDeadline(at("2026-03-27T10:00:00+01:00"))).toEqual(at("2026-04-07T13:00:00+02:00"));
  });

  it("skips Pfingstmontag", () => {
    expect(responseDeadline(at("2026-05-18T10:00:00+02:00"))).toEqual(at("2026-05-26T13:00:00+02:00"));
  });

  it("skips Buß- und Bettag (union of all Länder)", () => {
    expect(responseDeadline(at("2026-11-16T10:00:00+01:00"))).toEqual(at("2026-11-24T13:00:00+01:00"));
  });

  it("skips both Christmas days, 24.12 and 31.12 are working days", () => {
    expect(responseDeadline(at("2026-12-23T10:00:00+01:00"))).toEqual(at("2026-12-31T13:00:00+01:00"));
  });

  it("is unaffected by the autumn DST switch", () => {
    // Fri 23.10.2026 10:00 CEST; clocks go back on Sun 25.10.
    expect(responseDeadline(at("2026-10-23T10:00:00+02:00"))).toEqual(at("2026-10-30T13:00:00+01:00"));
  });
});

describe("Werktag (Folge 3, NRW)", () => {
  it("weekdays without NRW holidays", () => {
    expect(isWerktag("2026-11-18")).toBe(true); // Buß- und Bettag is no holiday in NRW
    expect(isWerktag("2026-06-04")).toBe(false); // Fronleichnam
    expect(isWerktag("2026-10-10")).toBe(false); // Saturday
  });

  it("next Werktag skips weekends and holidays", () => {
    expect(nextWerktag(at("2026-10-08T15:00:00+02:00"))).toBe("2026-10-09");
    expect(nextWerktag(at("2026-10-09T15:00:00+02:00"))).toBe("2026-10-12");
    expect(nextWerktag(at("2026-06-03T15:00:00+02:00"))).toBe("2026-06-05");
    expect(nextWerktag(at("2026-12-24T15:00:00+01:00"))).toBe("2026-12-28");
  });

  it("end of next Werktag is the following Berlin midnight", () => {
    expect(endOfNextWerktag(at("2026-10-08T15:00:00+02:00"))).toEqual(at("2026-10-10T00:00:00+02:00"));
    // A late-evening warning on Friday: Monday is the next Werktag.
    expect(endOfNextWerktag(at("2026-10-09T23:30:00+02:00"))).toEqual(at("2026-10-13T00:00:00+02:00"));
  });
});

describe("formatBerlinDateTime", () => {
  it("formats in Berlin time", () => {
    expect(formatBerlinDateTime(at("2026-10-19T11:00:00Z"))).toBe("19.10.2026, 13:00");
    expect(formatBerlinDateTime(null)).toBe("–");
  });
});

// ---------------------------------------------------------------------------
// DST change on 2026-10-25 (portal review K-garantie, missing tests 14, 15)
// ---------------------------------------------------------------------------

describe("Werkstunden across the 25-hour day 2026-10-25", () => {
  it("runs 48 Werkstunden from Friday CEST into the next week CET", () => {
    // Fr 23.10. 12:00 CEST -> Fr 30.10. 15:00 CET
    expect(addWorkingHours(at("2026-10-23T10:00:00Z"), 48).toISOString()).toBe("2026-10-30T14:00:00.000Z");
  });

  it("starts a Saturday-night inquiry on Monday 09:00 CET", () => {
    // Sa 24.10. 22:00 CEST: Mo 26.10. to Fr 30.10. = 45 h, Mo 02.11. 09:00 + 3 h
    expect(responseDeadline(at("2026-10-24T20:00:00Z")).toISOString()).toBe("2026-11-02T11:00:00.000Z");
  });

  it("ends the next Werktag at Berlin midnight after the change", () => {
    expect(endOfNextWerktag(at("2026-10-23T15:00:00Z")).toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(endOfNextWerktag(at("2026-10-31T10:00:00Z")).toISOString()).toBe("2026-11-02T23:00:00.000Z");
    // 25./26.12. holidays, 27.12. Sunday
    expect(endOfNextWerktag(at("2026-12-24T10:00:00Z")).toISOString()).toBe("2026-12-28T23:00:00.000Z");
  });

  it("separates the NRW Werktag from the any-Land holiday calendar (K-15)", () => {
    expect(isWerktag("2026-11-01")).toBe(false);
    expect(isWerktag("2026-11-02")).toBe(true);
    expect(isWerktag("2027-03-08")).toBe(true);
    expect(isAnyStatutoryHoliday("2027-03-08")).toBe(true);
  });
});
