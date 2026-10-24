import { describe, expect, it, vi } from "vitest";

// K-3 (INT-C 1): the monthly report counts only inquiries from the Praxis's
// signing date on. DB and guarantee clock are stubbed; the counting is real.
const rows = [
  // 2026-11-01 23:59 Berlin: before the signing day 02.11.
  { createdAt: new Date("2026-11-01T22:59:00Z"), status: "neu", firstAttemptAt: null },
  // 2026-11-02 00:00 Berlin: inside the rule, never answered.
  { createdAt: new Date("2026-11-01T23:00:00Z"), status: "neu", firstAttemptAt: null },
];

vi.mock("@/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/db/client")>("@/db/client");
  const chain = { from: () => chain, where: () => Promise.resolve(rows) };
  return { ...actual, db: { select: () => chain } };
});
vi.mock("@/server/guarantee-clock", async () => {
  const { responseRuleStartFor } = await vi.importActual<typeof import("@/lib/response-time")>(
    "@/lib/response-time"
  );
  return { responseRuleStartForClinic: vi.fn(async () => responseRuleStartFor("2026-11-02")) };
});

const { responseCountsForPeriod } = await import("./response-time");

describe("responseCountsForPeriod uses the Praxis rule start (K-3)", () => {
  it("does not count an inquiry before the signing date as nicht beantwortet", async () => {
    const counts = await responseCountsForPeriod(
      "00000000-0000-4000-8000-00000000000a",
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-12-01T00:00:00Z"),
      new Date("2026-12-01T12:00:00Z")
    );
    expect(counts).toMatchObject({ total: 1, nichtBeantwortet: 1, vorRegel: 1 });
  });
});
