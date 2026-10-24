import { describe, expect, it } from "vitest";
import { inquiriesInWindowsQuery } from "@/server/guarantee-clock";
import { responseRowsInPeriodQuery, toAttemptDate } from "./response-time";

// Builds the SQL only; postgres.js connects lazily, so no DB is needed.
describe("firstAttemptAtSql", () => {
  const { sql } = responseRowsInPeriodQuery(
    "00000000-0000-4000-8000-00000000000a",
    new Date("2026-10-01T00:00:00Z"),
    new Date("2026-11-01T00:00:00Z")
  ).toSQL();

  it("takes the earliest contact activity, correlated to the request row", () => {
    expect(sql).toMatch(/LEAST\(/);
    expect(sql).toMatch(/min\(ra\.created_at\)/);
    expect(sql).toMatch(/ra\.request_id = "requests"\."id"/);
    expect(sql).toContain("ra.kind IN ('call', 'email', 'whatsapp')");
  });

  it("counts status changes except spam, verloren and back to neu, plus PVS bookings", () => {
    expect(sql).toContain("ra.meta->>'to' NOT IN ('spam', 'verloren', 'neu')");
    expect(sql).toContain("ra.meta->>'source' = 'pvs'");
  });

  it("counts a booking-link inquiry at its arrival and ignores first_contacted_at", () => {
    expect(sql).toMatch(/CASE WHEN "requests"\."source" IN \('buchung', 'buchungslink', 'booking', 'booking_link'\) THEN "requests"\."created_at" END/);
    expect(sql).not.toContain("first_contacted_at");
  });

  it("travels inside the Garantie-Uhr window subquery", () => {
    const q = inquiriesInWindowsQuery([
      { clinicId: "00000000-0000-4000-8000-00000000000a", signedOn: "2026-10-01", deadline: "2026-12-30" },
    ]).toSQL().sql;
    expect(q).toMatch(/as "first_attempt_at"/);
    expect(q).toMatch(/"ranked"\."first_attempt_at"|"first_attempt_at" from/);
  });
});

describe("toAttemptDate", () => {
  it("accepts postgres strings, Dates and null", () => {
    expect(toAttemptDate("2026-10-12 08:00:00+00")?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(toAttemptDate(new Date("2026-10-12T08:00:00Z"))?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(toAttemptDate(null)).toBeNull();
    expect(toAttemptDate("kaputt")).toBeNull();
  });
});
