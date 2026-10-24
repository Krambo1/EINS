import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PvsEvent } from "./pvs-events";

/**
 * Retry black hole + apply bookkeeping for applyPvsEvent / reapplyLoggedEvent.
 *
 * The db is a table-tagged stub (same idea as pvs-events.apply.test.ts) with
 * a configurable pvs_event_log row, so we can drive: first ingest, agent
 * retry of a half-applied row, enqueue results, and the reapply entry point.
 */

interface State {
  link: { id: string; clinicId: string; vendor: string; status: string } | null;
  /** What the event_log INSERT ... ON CONFLICT DO NOTHING RETURNING yields. */
  insertReturns: Array<{ id: string }>;
  /** The existing row a dedupe / reapply lookup finds. */
  existing:
    | {
        id: string;
        clinicId: string;
        payload: unknown;
        payloadSig: string | null;
        appliedAt: Date | null;
        linkStatusAtIngest: string;
      }
    | null;
  /** Rows the pgboss coalesce lookup (db.execute) returns. */
  queuedJobs: unknown[];
  /** pvs_link_source rows. */
  sources: Array<{ bridgeSource: string; billingEnabled?: boolean }>;
}
let state: State;
let writes: Array<{ table?: string; op: string; values: unknown }>;
let deriveResult: string | null | undefined;
let linkingThrows: boolean;
const upsert = vi.fn();
const resolveLink = vi.fn();

function rowsFor(table: { __tag?: string }): unknown[] {
  if (table.__tag === "pvs_link") return state.link ? [{ ...state.link, vendor: state.link.vendor }] : [];
  if (table.__tag === "pvs_link_source") return state.sources.map((r) => ({ ...r }));
  if (table.__tag === "pvs_event_log") return state.existing ? [{ ...state.existing }] : [];
  return [];
}

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: (table: { __tag?: string }) => ({
        where: () => {
          const rows = rowsFor(table);
          const p = Promise.resolve(rows) as Promise<unknown[]> & {
            limit: (n: number) => Promise<unknown[]>;
          };
          p.limit = async () => rows;
          return p;
        },
      }),
    }),
    insert: (table: { __tag?: string }) => ({
      values: (vals: unknown) => {
        writes.push({ table: table.__tag, op: "insert", values: vals });
        return {
          onConflictDoNothing: () => ({
            returning: async () =>
              table.__tag === "pvs_event_log" ? state.insertReturns : [],
          }),
          onConflictDoUpdate: () => Promise.resolve([]),
          returning: async () => [],
        };
      },
    }),
    update: (table: { __tag?: string }) => ({
      set: (vals: unknown) => {
        writes.push({ table: table.__tag, op: "update", values: vals });
        return { where: () => Promise.resolve([]) };
      },
    }),
    execute: async () => state.queuedJobs,
  },
  schema: {
    pvsLink: { __tag: "pvs_link", id: {}, clinicId: {}, pvsVendor: {}, status: {} },
    pvsLinkSource: { __tag: "pvs_link_source", clinicId: {}, bridgeSource: {}, billingEnabled: {} },
    dashboardAlerts: { __tag: "dashboard_alerts", clinicId: {}, dedupeKey: {} },
    pvsEventLog: {
      __tag: "pvs_event_log",
      id: {},
      clinicId: {},
      bridgeSource: {},
      pvsExternalEventId: {},
      occurredAt: {},
      appliedAt: {},
      linkStatusAtIngest: {},
      payload: {},
      payloadSig: {},
    },
    pvsSyncStatus: { __tag: "pvs_sync_status", pvsLinkId: {}, totalEventsIngested: {}, totalEventsLast24h: {} },
  },
}));
vi.mock("@/lib/env", () => ({
  env: { APP_KEY: "00".repeat(32), SESSION_SECRET: "0".repeat(64) },
}));
vi.mock("@/server/jobs", () => ({
  enqueuePvsStatusDerive: async () => deriveResult,
  enqueuePvsLinkBackfill: async () => "bf-1",
}));
vi.mock("@/server/pvs-linking", () => ({
  resolvePatientLink: (...a: unknown[]) => resolveLink(...a),
  recordLinkingFailure: async () => {},
  upsertPatientFromPvs: (...a: unknown[]) => upsert(...a),
}));
vi.mock("@/worker/processors/pvs-partition-rotate", () => ({
  ensurePartitionForMonth: async () => {},
}));

const CLINIC = "11111111-2222-3333-4444-555555555555";

function paid(over: Record<string, unknown> = {}): PvsEvent {
  return {
    kind: "InvoicePaid",
    clinicId: CLINIC,
    bridgeSource: "tomedo",
    pvsExternalEventId: "evt-1",
    occurredAt: "2026-05-31T10:00:00.000Z",
    pvsPatientId: "P-1",
    pvsInvoiceId: "I-1",
    amountCents: 45000,
    currency: "EUR",
    paidAt: "2026-05-31T10:00:00.000Z",
    ...over,
  } as PvsEvent;
}

let mod: typeof import("./pvs-events");

beforeEach(async () => {
  state = {
    link: { id: "link-1", clinicId: CLINIC, vendor: "tomedo", status: "connected" },
    insertReturns: [{ id: "evt-new" }],
    existing: null,
    queuedJobs: [],
    sources: [],
  };
  writes = [];
  deriveResult = "job-1";
  linkingThrows = false;
  upsert.mockReset();
  resolveLink.mockReset();
  resolveLink.mockImplementation(async () => {
    if (linkingThrows) throw new Error("linker boom");
    return { portalPatientId: "pat-1", method: "external_id" };
  });
  vi.resetModules();
  mod = await import("./pvs-events");
});

const appliedWrites = () =>
  writes.filter(
    (w) =>
      w.table === "pvs_event_log" &&
      w.op === "update" &&
      (w.values as { appliedAt?: Date }).appliedAt instanceof Date
  );

describe("applyPvsEvent: first ingest", () => {
  it("stamps applied_at when derive was enqueued", async () => {
    const res = await mod.applyPvsEvent(paid());
    expect(res).toMatchObject({ ok: true, status: "ingested", eventLogId: "evt-new" });
    expect(appliedWrites()).toHaveLength(1);
  });

  it("does NOT stamp applied_at when the derive enqueue failed (null, nothing queued)", async () => {
    deriveResult = null;
    state.queuedJobs = [];
    const res = await mod.applyPvsEvent(paid());
    expect(res).toMatchObject({ ok: true, status: "ingested" });
    expect(appliedWrites()).toHaveLength(0);
  });

  it("stamps applied_at when null is a coalesce with a still-queued derive job", async () => {
    deriveResult = null;
    state.queuedJobs = [{ queued: 1 }];
    await mod.applyPvsEvent(paid());
    expect(appliedWrites()).toHaveLength(1);
  });

  it("linking failure -> internal_error, applied_at stays NULL", async () => {
    linkingThrows = true;
    const res = await mod.applyPvsEvent(paid());
    expect(res).toEqual({ ok: false, reason: "internal_error" });
    expect(appliedWrites()).toHaveLength(0);
  });

  it("rejects occurredAt outside [2000-01-01, now+2y] as invalid_envelope", async () => {
    for (const bad of ["0001-01-01T00:00:00.000Z", "9999-12-31T00:00:00.000Z", "1999-12-31T23:59:59.000Z"]) {
      const res = await mod.applyPvsEvent(paid({ occurredAt: bad }));
      expect(res).toEqual({ ok: false, reason: "invalid_envelope" });
    }
  });
});

describe("applyPvsEvent: agent retry of a half-applied row (retry black hole)", () => {
  beforeEach(() => {
    state.insertReturns = []; // ON CONFLICT DO NOTHING -> dedupe
  });

  it("existing row with applied_at NULL is re-applied and reported as ingested", async () => {
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: null,
      linkStatusAtIngest: "connected",
    };
    const res = await mod.applyPvsEvent(paid());
    expect(res).toMatchObject({ ok: true, status: "ingested", eventLogId: "evt-old" });
    expect(resolveLink).toHaveBeenCalled();
    expect(appliedWrites()).toHaveLength(1);
  });

  it("a retry whose linking fails again stays a 500 (agent keeps the event)", async () => {
    linkingThrows = true;
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: null,
      linkStatusAtIngest: "connected",
    };
    expect(await mod.applyPvsEvent(paid())).toEqual({ ok: false, reason: "internal_error" });
  });

  it("fully applied row -> deduped, nothing re-run", async () => {
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: new Date(),
      linkStatusAtIngest: "connected",
    };
    expect(await mod.applyPvsEvent(paid())).toEqual({ ok: true, status: "deduped" });
    expect(resolveLink).not.toHaveBeenCalled();
  });

  it("row quarantined under a pending link -> deduped (confirmPvsLinkActive owns it)", async () => {
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: null,
      linkStatusAtIngest: "pending",
    };
    expect(await mod.applyPvsEvent(paid())).toEqual({ ok: true, status: "deduped" });
    expect(resolveLink).not.toHaveBeenCalled();
  });
});

describe("reapplyLoggedEvent", () => {
  it("re-applies an unapplied row and stamps applied_at", async () => {
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: null,
      linkStatusAtIngest: "connected",
    };
    expect(await mod.reapplyLoggedEvent("evt-old")).toEqual({ ok: true, status: "reapplied" });
    expect(appliedWrites()).toHaveLength(1);
  });

  it("reports unconfirmed when the enqueue was not confirmed", async () => {
    deriveResult = null;
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: null,
      linkStatusAtIngest: "connected",
    };
    expect(await mod.reapplyLoggedEvent("evt-old")).toEqual({ ok: true, status: "unconfirmed" });
    expect(appliedWrites()).toHaveLength(0);
  });

  it("refuses a row whose integrity tag does not match", async () => {
    state.existing = {
      id: "evt-old",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: "00".repeat(32),
      appliedAt: null,
      linkStatusAtIngest: "connected",
    };
    expect(await mod.reapplyLoggedEvent("evt-old")).toEqual({ ok: false, reason: "integrity_failed" });
  });

  it("skips applied and quarantined rows, reports a missing row", async () => {
    state.existing = {
      id: "e",
      clinicId: CLINIC,
      payload: paid(),
      payloadSig: null,
      appliedAt: new Date(),
      linkStatusAtIngest: "connected",
    };
    expect(await mod.reapplyLoggedEvent("e")).toEqual({ ok: true, status: "already_applied" });
    state.existing = { ...state.existing, appliedAt: null, linkStatusAtIngest: "pending" };
    expect(await mod.reapplyLoggedEvent("e")).toEqual({ ok: true, status: "quarantined" });
    state.existing = null;
    expect(await mod.reapplyLoggedEvent("e")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("billing-conflict alert", () => {
  it("writes observedValue null (numeric column) and names the sources in the body", async () => {
    // gdt_agent revenue event while the link's own vendor (medatixx) is an
    // implicit billing path: the vendor wins, gdt_agent is blocked.
    state.link = { id: "link-1", clinicId: CLINIC, vendor: "medatixx", status: "connected" };
    state.sources = [{ bridgeSource: "gdt_agent", billingEnabled: true }];
    const res = await mod.applyPvsEvent(paid({ bridgeSource: "gdt_agent" }));
    expect(res).toEqual({ ok: false, reason: "billing_conflict" });
    const alert = writes.find((w) => w.table === "dashboard_alerts");
    expect(alert).toBeDefined();
    const v = alert!.values as { observedValue: unknown; body: string };
    expect(v.observedValue).toBeNull();
    expect(v.body).toContain("gdt_agent");
    expect(v.body).toContain("medatixx");
  });
});
