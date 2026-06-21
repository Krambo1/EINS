import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * EINS Bewertungen — review-request scheduler tests.
 *
 * Covers scheduleReviewRequest, the shared insert helper the PVS derive worker
 * calls, including the per-appointment idempotency guard that stops a
 * re-derived encounter from scheduling a second email.
 *
 * We stub @/db/client with a per-table __tag dispatch (mirrors
 * pvs-events.apply.test.ts) so the test is about the branching, not Postgres.
 */

interface MockState {
  suppression: { id: string } | null;
  /** anti-spam: a recent review_email_schedule row (ordered query). */
  recentReview: { id: string } | null;
  /** per-appointment dedup: a review for this pvs appointment (unordered query). */
  apptDupe: { id: string } | null;
  /** simulate the onConflictDoNothing backstop firing (no row returned). */
  reviewInsertConflicts: boolean;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
}

let state: MockState;

function selectRowsFor(table: { __tag?: string }, ordered: boolean): unknown[] {
  switch (table.__tag) {
    case "email_suppression":
      return state.suppression ? [state.suppression] : [];
    case "review_email_schedule":
      // The anti-spam query uses orderBy; the per-appointment dedup does not.
      return ordered
        ? state.recentReview
          ? [state.recentReview]
          : []
        : state.apptDupe
          ? [state.apptDupe]
          : [];
    default:
      return [];
  }
}

function buildSelect() {
  return {
    from: (table: { __tag?: string }) => ({
      where: (_clause: unknown) => ({
        orderBy: (_o: unknown) => ({
          limit: async (_n: number) => selectRowsFor(table, true),
        }),
        limit: async (_n: number) => selectRowsFor(table, false),
      }),
    }),
  };
}

function buildInsert(table: { __tag?: string }) {
  const tag = table.__tag ?? "";
  const ret = async (values: Record<string, unknown>) => {
    state.inserts.push({ table: tag, values });
    if (tag === "patients") return [{ id: "pat-new" }];
    if (tag === "review_email_schedule") {
      return state.reviewInsertConflicts ? [] : [{ id: "rev-new" }];
    }
    return [];
  };
  return {
    values: (vals: Record<string, unknown>) => ({
      returning: () => ret(vals),
      onConflictDoNothing: (_spec?: unknown) => ({ returning: () => ret(vals) }),
      onConflictDoUpdate: (_spec?: unknown) => Promise.resolve([]),
    }),
  };
}

function buildUpdate(_table: { __tag?: string }) {
  return {
    set: (_vals: unknown) => ({
      where: (_clause: unknown) => Promise.resolve([]),
    }),
  };
}

vi.mock("@/db/client", () => ({
  db: {
    select: (_cols?: unknown) => buildSelect(),
    insert: (table: unknown) => buildInsert(table as { __tag?: string }),
    update: (table: unknown) => buildUpdate(table as { __tag?: string }),
  },
  schema: {
    patients: {
      __tag: "patients",
      id: {},
      clinicId: {},
      email: {},
      fullName: {},
    },
    emailSuppression: { __tag: "email_suppression", id: {}, clinicId: {}, email: {} },
    reviewEmailSchedule: {
      __tag: "review_email_schedule",
      id: {},
      clinicId: {},
      patientId: {},
      kind: {},
      createdAt: {},
      pvsAppointmentId: {},
    },
  },
}));

let scheduleReviewRequest: typeof import("./patient-events").scheduleReviewRequest;

beforeEach(async () => {
  state = {
    suppression: null,
    recentReview: null,
    apptDupe: null,
    reviewInsertConflicts: false,
    inserts: [],
  };
  vi.resetModules();
  const mod = await import("./patient-events");
  scheduleReviewRequest = mod.scheduleReviewRequest;
});

afterEach(() => vi.restoreAllMocks());

const CLINIC = "11111111-2222-3333-4444-555555555555";

function reviewInserts() {
  return state.inserts.filter((i) => i.table === "review_email_schedule");
}

describe("scheduleReviewRequest — PVS per-appointment idempotency", () => {
  const base = {
    clinicId: CLINIC,
    patientId: "pat-1",
    email: "lead@example.com",
    patientName: "Lead Person",
    treatmentLabel: "Botox",
    completedAt: new Date("2026-05-20T10:00:00.000Z"),
    delayDays: 3,
    requestId: "req-1",
    pvsAppointmentId: "A1",
    pvsEncounterId: "E1",
  };

  it("schedules and persists the PVS linkage columns on first completion", async () => {
    const res = await scheduleReviewRequest(base);
    expect(res).toEqual({
      status: "scheduled",
      reviewRequestId: "rev-new",
      scheduledFor: "2026-05-23",
    });
    const [row] = reviewInserts();
    expect(row!.values.pvsAppointmentId).toBe("A1");
    expect(row!.values.pvsEncounterId).toBe("E1");
    expect(row!.values.requestId).toBe("req-1");
  });

  it("normalizes the email and dates from completion + delay", async () => {
    const res = await scheduleReviewRequest({
      ...base,
      email: "Lead@Example.com ",
      pvsAppointmentId: null,
    });
    expect(res).toEqual({
      status: "scheduled",
      reviewRequestId: "rev-new",
      scheduledFor: "2026-05-23", // 2026-05-20 + 3 delay days
    });
    const [row] = reviewInserts();
    expect(row!.values.reviewEmail).toBe("lead@example.com");
  });

  it("dedupes when the patient is on the suppression list (no insert)", async () => {
    state.suppression = { id: "supp-1" };
    const res = await scheduleReviewRequest(base);
    expect(res).toEqual({ status: "deduped" });
    expect(reviewInserts()).toHaveLength(0);
  });

  it("dedupes within the 90-day anti-spam window (no insert)", async () => {
    state.recentReview = { id: "rev-recent" };
    const res = await scheduleReviewRequest({ ...base, pvsAppointmentId: null });
    expect(res).toEqual({ status: "deduped" });
    expect(reviewInserts()).toHaveLength(0);
  });

  it("dedupes when a review already exists for the same PVS appointment (re-derive safe)", async () => {
    state.apptDupe = { id: "rev-existing" };
    const res = await scheduleReviewRequest(base);
    expect(res).toEqual({ status: "deduped" });
    expect(reviewInserts()).toHaveLength(0);
  });

  it("dedupes when the unique-index backstop fires on a concurrent insert", async () => {
    state.reviewInsertConflicts = true;
    const res = await scheduleReviewRequest(base);
    expect(res).toEqual({ status: "deduped" });
  });
});
