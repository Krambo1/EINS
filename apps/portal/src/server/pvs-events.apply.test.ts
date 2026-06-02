import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PvsEvent } from "./pvs-events";

/**
 * Logic-level tests for applyPvsEvent's Phase 7 provenance membership check.
 *
 * The HMAC already authenticated the clinic; bridge_source is a provenance
 * label, so applyPvsEvent accepts an event when the source is universal
 * (csv_upload / n8n_custom), matches the clinic's vendor (fast path), or has a
 * pvs_link_source row. A miss is vendor_mismatch, which the route maps to a
 * retryable 409 (NOT a permanent 400) so the agent retries until its heartbeat
 * seeds the source.
 *
 * We stub @/db/client and the side-effect collaborators so the test is about
 * the gate, not Postgres. The db mock dispatches on a per-table __tag, mirroring
 * pvs-agent-enroll.test.ts.
 */

interface MockState {
  link: {
    id: string;
    clinicId: string;
    vendor: string;
    status: string;
  } | null;
  // Rows pvs_link_source returns for the membership lookup.
  membership: Array<{ bridgeSource: string }>;
}

let state: MockState;

function selectRowsFor(table: { __tag?: string }): unknown[] {
  if (table.__tag === "pvs_link") {
    return state.link
      ? [
          {
            id: state.link.id,
            clinicId: state.link.clinicId,
            vendor: state.link.vendor,
            status: state.link.status,
          },
        ]
      : [];
  }
  if (table.__tag === "pvs_link_source") {
    return state.membership.map((r) => ({ ...r }));
  }
  return [];
}

function buildSelect() {
  return {
    from: (table: { __tag?: string }) => ({
      where: (_clause: unknown) => ({
        limit: async (_n: number) => selectRowsFor(table),
      }),
    }),
  };
}

function buildInsert(table: { __tag?: string }) {
  const ret = async () =>
    table.__tag === "pvs_event_log" ? [{ id: "evt-1" }] : [];
  return {
    values: (_vals: unknown) => ({
      // event_log: .onConflictDoNothing().returning()
      onConflictDoNothing: (_spec?: unknown) => ({ returning: ret }),
      // sync_status touchLink: .onConflictDoUpdate() (awaited directly)
      onConflictDoUpdate: (_spec?: unknown) => Promise.resolve([]),
      returning: ret,
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
    pvsLink: {
      __tag: "pvs_link",
      id: {},
      clinicId: {},
      pvsVendor: {},
      status: {},
    },
    pvsLinkSource: {
      __tag: "pvs_link_source",
      clinicId: {},
      bridgeSource: {},
    },
    pvsEventLog: { __tag: "pvs_event_log", id: {} },
    pvsSyncStatus: {
      __tag: "pvs_sync_status",
      pvsLinkId: {},
      totalEventsIngested: {},
      totalEventsLast24h: {},
    },
  },
}));

// @/lib/env is pulled in transitively (jobs.ts reads env.REDIS_URL at module
// load). Stub it so the import graph resolves without real env vars.
vi.mock("@/lib/env", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    APP_KEY: "00".repeat(32),
  },
}));

// Side-effect collaborators — no-ops / fixed returns so the flow completes.
vi.mock("@/server/jobs", () => ({
  enqueuePvsStatusDerive: async () => {},
  enqueuePvsLinkBackfill: async () => {},
}));
vi.mock("@/server/pvs-linking", () => ({
  resolvePatientLink: async () => ({
    portalPatientId: "pat-1",
    method: "external_id",
  }),
  recordLinkingFailure: async () => {},
  upsertPatientFromPvs: async () => ({
    portalPatientId: "pat-1",
    method: "external_id",
    candidates: [],
  }),
}));
vi.mock("@/worker/processors/pvs-partition-rotate", () => ({
  ensurePartitionForMonth: async () => {},
}));

let applyPvsEvent: typeof import("./pvs-events").applyPvsEvent;

beforeEach(async () => {
  state = { link: null, membership: [] };
  vi.resetModules();
  applyPvsEvent = (await import("./pvs-events")).applyPvsEvent;
});

afterEach(() => vi.restoreAllMocks());

const CLINIC = "11111111-2222-3333-4444-555555555555";

function invoicePaid(bridgeSource: string): PvsEvent {
  return {
    kind: "InvoicePaid",
    clinicId: CLINIC,
    bridgeSource,
    pvsExternalEventId: "evt-ext-1",
    occurredAt: "2026-05-31T10:00:00.000Z",
    pvsPatientId: "P-1",
    pvsInvoiceId: "I-1",
    amountCents: 45000,
    currency: "EUR",
    paidAt: "2026-05-31T10:00:00.000Z",
  } as PvsEvent;
}

describe("applyPvsEvent — Phase 7 provenance membership", () => {
  it("accepts when bridgeSource matches the clinic's vendor (fast path)", async () => {
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "tomedo",
      status: "connected",
    };
    const res = await applyPvsEvent(invoicePaid("tomedo"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
  });

  it("accepts a universal source (csv_upload) regardless of vendor", async () => {
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "tomedo",
      status: "connected",
    };
    const res = await applyPvsEvent(invoicePaid("csv_upload"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
  });

  it("DONE-WHEN: a medatixx event with a seeded pvs_link_source row ingests", async () => {
    // The medatixx Praxis enrolled via the GDT agent, so pvs_link.vendor is
    // gdt_agent; the membership row is what authorizes the medatixx source.
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "gdt_agent",
      status: "connected",
    };
    state.membership = [{ bridgeSource: "medatixx" }];
    const res = await applyPvsEvent(invoicePaid("medatixx"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
  });

  it("DONE-WHEN: the same medatixx event with NO row → vendor_mismatch (→ 409)", async () => {
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "gdt_agent",
      status: "connected",
    };
    state.membership = []; // not enrolled yet
    const res = await applyPvsEvent(invoicePaid("medatixx"));
    expect(res).toEqual({ ok: false, reason: "vendor_mismatch" });
  });

  it("still rejects a mismatched source when the clinic has OTHER sources only", async () => {
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "gdt_agent",
      status: "connected",
    };
    // Enrolled for cgm_albis, but the event claims medatixx → no row for it.
    state.membership = [];
    const res = await applyPvsEvent(invoicePaid("medatixx"));
    expect(res).toEqual({ ok: false, reason: "vendor_mismatch" });
  });
});
