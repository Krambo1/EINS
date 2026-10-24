import { afterEach, describe, expect, it, vi } from "vitest";
import { INQUIRIES_PER_CLINIC_LIMIT, inquiriesInWindowsQuery, todayBerlin } from "./guarantee-clock";

// Builds the SQL only; postgres.js connects lazily, so no DB is needed.
describe("inquiriesInWindowsQuery", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";

  it("caps per clinic, not globally, and gives each clinic its own window", () => {
    const { sql, params } = inquiriesInWindowsQuery([
      { clinicId: A, signedOn: "2026-01-10", deadline: "2026-04-10" },
      { clinicId: B, signedOn: "2026-09-01", deadline: "2026-11-30" },
    ]).toSQL();

    expect(sql).toMatch(/row_number\(\) over \(partition by ("requests"\.)?"clinic_id"/);
    expect(sql).toMatch(/"rn" <= \$\d+/);
    expect(sql).not.toMatch(/\blimit\b/i);
    expect(params).toContain(INQUIRIES_PER_CLINIC_LIMIT);

    const isoParams = params.map((p) => (p instanceof Date ? p.toISOString() : p));
    expect(isoParams).toEqual(
      expect.arrayContaining([
        A,
        "2026-01-09T00:00:00.000Z",
        "2026-04-12T00:00:00.000Z",
        B,
        "2026-08-31T00:00:00.000Z",
        "2026-12-02T00:00:00.000Z",
      ])
    );
  });
});

describe("todayBerlin", () => {
  afterEach(() => vi.useRealTimers());

  it("reads the Berlin day on a UTC server around the DST change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T22:30:00Z"));
    expect(todayBerlin()).toBe("2026-10-25");
    vi.setSystemTime(new Date("2026-10-25T23:30:00Z"));
    expect(todayBerlin()).toBe("2026-10-26");
  });
});
