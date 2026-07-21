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
  // Rows pvs_link_source returns for the membership lookup + the M-D6
  // billing-authority gate. billingEnabled omitted = column default (true).
  membership: Array<{ bridgeSource: string; billingEnabled?: boolean }>;
}

let state: MockState;

/** Every db.insert(...).values(...) call, so the M-D6 tests can assert the
 *  persisted billing_enabled flip + the dashboard alert without a real DB. */
interface WriteRecord {
  table: string | undefined;
  values: Record<string, unknown>;
}
let writes: WriteRecord[];

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
      // The membership lookup chains .limit(1); the M-D6 billing gate awaits
      // the where() result directly (it wants ALL of the clinic's source
      // rows). Support both by returning a thenable that also has .limit.
      where: (_clause: unknown) => {
        const rows = selectRowsFor(table);
        const p = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: (n: number) => Promise<unknown[]>;
        };
        p.limit = async (_n: number) => rows;
        return p;
      },
    }),
  };
}

function buildInsert(table: { __tag?: string }) {
  const ret = async () =>
    table.__tag === "pvs_event_log" ? [{ id: "evt-1" }] : [];
  return {
    values: (vals: unknown) => {
      writes.push({
        table: table.__tag,
        values: vals as Record<string, unknown>,
      });
      return {
        // event_log: .onConflictDoNothing().returning()
        onConflictDoNothing: (_spec?: unknown) => ({ returning: ret }),
        // sync_status touchLink + M-D6 upserts: .onConflictDoUpdate()
        // (awaited directly)
        onConflictDoUpdate: (_spec?: unknown) => Promise.resolve([]),
        returning: ret,
      };
    },
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
      pvsVendor: {},
      enrolledVia: {},
      billingEnabled: {},
    },
    dashboardAlerts: {
      __tag: "dashboard_alerts",
      clinicId: {},
      dedupeKey: {},
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

// @/lib/env is pulled in transitively by the import graph. Stub it so imports
// resolve without real env vars. SESSION_SECRET is needed by the H3 payload
// integrity tag computed at event_log insert (deriveSigningKey).
vi.mock("@/lib/env", () => ({
  env: {
    APP_KEY: "00".repeat(32),
    SESSION_SECRET: "0".repeat(64),
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
  writes = [];
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

// ---------------------------------------------------------------
// M-D6 billing-authority gate (dual-ingest-path mutual exclusion)
// ---------------------------------------------------------------

function invoiceRefunded(bridgeSource: string): PvsEvent {
  return {
    kind: "InvoiceRefunded",
    clinicId: CLINIC,
    bridgeSource,
    pvsExternalEventId: "evt-ext-2",
    occurredAt: "2026-05-31T11:00:00.000Z",
    pvsPatientId: "P-1",
    pvsInvoiceId: "I-1",
    refundedAmountCents: 45000,
    currency: "EUR",
    refundedAt: "2026-05-31T11:00:00.000Z",
  } as PvsEvent;
}

function patientUpserted(bridgeSource: string): PvsEvent {
  return {
    kind: "PatientUpserted",
    clinicId: CLINIC,
    bridgeSource,
    pvsExternalEventId: "evt-ext-3",
    occurredAt: "2026-05-31T09:00:00.000Z",
    pvsPatientId: "P-1",
    fullName: "Maria Muster",
  } as PvsEvent;
}

describe("applyPvsEvent — M-D6 billing-authority gate", () => {
  function gdtAgentClinic() {
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "gdt_agent",
      status: "connected",
    };
  }

  const linkSourceWrites = () =>
    writes.filter((w) => w.table === "pvs_link_source");
  const alertWrites = () =>
    writes.filter((w) => w.table === "dashboard_alerts");

  it("DONE-WHEN: gdt_agent InvoicePaid colliding with a billing-enabled DB source → billing_conflict, flag persisted, standing alert", async () => {
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: true },
      { bridgeSource: "medatixx", billingEnabled: true },
    ];
    const res = await applyPvsEvent(invoicePaid("gdt_agent"));
    expect(res).toEqual({ ok: false, reason: "billing_conflict" });
    // The resolution is persisted: gdt_agent's billing flag flips to false so
    // subsequent events fail fast on the flag alone.
    expect(
      linkSourceWrites().some(
        (w) =>
          w.values.bridgeSource === "gdt_agent" &&
          w.values.billingEnabled === false
      )
    ).toBe(true);
    // The drop is never silent: a standing dashboard alert is raised.
    expect(
      alertWrites().some(
        (w) => w.values.dedupeKey === "pvs_billing_conflict:gdt_agent"
      )
    ).toBe(true);
    // And no event_log row was written — the duplicate never enters derive.
    expect(writes.some((w) => w.table === "pvs_event_log")).toBe(false);
  });

  it("gdt_agent InvoicePaid with no competing vendor path ingests normally", async () => {
    gdtAgentClinic();
    state.membership = [{ bridgeSource: "gdt_agent", billingEnabled: true }];
    const res = await applyPvsEvent(invoicePaid("gdt_agent"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
    expect(alertWrites()).toHaveLength(0);
  });

  it("rejects on the standing flag alone (already resolved earlier or by the 0067 backfill)", async () => {
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: false },
      { bridgeSource: "medatixx", billingEnabled: true },
    ];
    const res = await applyPvsEvent(invoicePaid("gdt_agent"));
    expect(res).toEqual({ ok: false, reason: "billing_conflict" });
    // Already false — no redundant flip, but the alert is refreshed.
    expect(
      linkSourceWrites().filter(
        (w) => w.values.billingEnabled === false
      )
    ).toHaveLength(0);
    expect(alertWrites()).toHaveLength(1);
  });

  it("the vendor DB source keeps flowing while gdt_agent is merely enrolled (no pre-emptive alert)", async () => {
    // Every agent-enrolled clinic has a gdt_agent row (the watcher is always
    // on). That alone is NOT a conflict — only an actual GDT revenue event is.
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: true },
      { bridgeSource: "medatixx", billingEnabled: true },
    ];
    const res = await applyPvsEvent(invoicePaid("medatixx"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
    expect(alertWrites()).toHaveLength(0);
  });

  it("a vendor DB source explicitly billing-disabled (GDT-wins override) is rejected with an alert", async () => {
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: true },
      { bridgeSource: "medatixx", billingEnabled: false },
    ];
    const res = await applyPvsEvent(invoicePaid("medatixx"));
    expect(res).toEqual({ ok: false, reason: "billing_conflict" });
    expect(
      alertWrites().some(
        (w) => w.values.dedupeKey === "pvs_billing_conflict:medatixx"
      )
    ).toBe(true);
  });

  it("counts pvs_link.pvs_vendor as an implicit vendor path (cloud-adapter fast path, no source row)", async () => {
    // A tomedo cloud clinic never needs a pvs_link_source row for its own
    // vendor. Its presence must still block gdt_agent revenue.
    state.link = {
      id: "link-1",
      clinicId: CLINIC,
      vendor: "tomedo",
      status: "connected",
    };
    state.membership = [{ bridgeSource: "gdt_agent", billingEnabled: true }];
    const res = await applyPvsEvent(invoicePaid("gdt_agent"));
    expect(res).toEqual({ ok: false, reason: "billing_conflict" });
  });

  it("InvoiceRefunded is gated exactly like InvoicePaid", async () => {
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: true },
      { bridgeSource: "medatixx", billingEnabled: true },
    ];
    const res = await applyPvsEvent(invoiceRefunded("gdt_agent"));
    expect(res).toEqual({ ok: false, reason: "billing_conflict" });
  });

  it("non-revenue kinds are never gated — mixed setups over disjoint data kinds stay legal", async () => {
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: false },
      { bridgeSource: "medatixx", billingEnabled: true },
    ];
    const res = await applyPvsEvent(patientUpserted("gdt_agent"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
  });

  it("csv_upload InvoicePaid stays exempt (operator-driven backfill)", async () => {
    gdtAgentClinic();
    state.membership = [
      { bridgeSource: "gdt_agent", billingEnabled: false },
      { bridgeSource: "medatixx", billingEnabled: true },
    ];
    const res = await applyPvsEvent(invoicePaid("csv_upload"));
    expect(res).toMatchObject({ ok: true, status: "ingested" });
  });
});
