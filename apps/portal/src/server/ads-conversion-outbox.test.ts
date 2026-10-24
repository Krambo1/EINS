import { beforeEach, describe, expect, it, vi } from "vitest";

let eventRow: { kind: string; bridgeSource: string; payload: unknown } | null;
let inserts: Array<Record<string, unknown>>;
const enqueueOci = vi.fn(async () => "job");
const enqueueCapi = vi.fn(async () => "job");

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (eventRow ? [eventRow] : []) }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: async () => [{ id: `ob-${inserts.length}` }],
          }),
        };
      },
    }),
  },
  schema: {
    pvsEventLog: { id: {}, clinicId: {}, kind: {}, bridgeSource: {}, payload: {} },
    adsConversionOutbox: { id: {} },
  },
}));
vi.mock("@/server/jobs", () => ({
  enqueueCapiPurchase: () => enqueueCapi(),
  enqueueOciPurchase: () => enqueueOci(),
}));
vi.mock("@/lib/ads-report-gate", () => ({ META_PURCHASE_REPORTING: false }));

import {
  conversionOrderId,
  enqueueInvoiceConversions,
  invoiceDedupKey,
} from "./ads-conversion-outbox";

const CLINIC = "11111111-2222-3333-4444-555555555555";
const base = {
  clinicId: CLINIC,
  requestId: "req-1",
  valueEur: 450,
  occurredAt: new Date("2026-05-31T10:00:00Z"),
};

beforeEach(() => {
  inserts = [];
  eventRow = {
    kind: "InvoicePaid",
    bridgeSource: "medatixx",
    payload: { pvsInvoiceId: "INV-7" },
  };
  enqueueOci.mockClear();
});

describe("enqueueInvoiceConversions: one Purchase per invoice", () => {
  it("a re-emitted invoice (new pvs_event_log id) gets the SAME dedup key and order id", async () => {
    await enqueueInvoiceConversions({ ...base, pvsEventLogId: "log-1" });
    await enqueueInvoiceConversions({ ...base, pvsEventLogId: "log-2" });
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.dedupKey).toBe(inserts[1]!.dedupKey);
    expect(inserts[0]!.dedupKey).toBe(invoiceDedupKey(CLINIC, "medatixx", "INV-7"));
    expect(inserts[0]).toMatchObject({ bridgeSource: "medatixx", pvsInvoiceId: "INV-7" });
    expect(
      conversionOrderId({
        dedupKey: inserts[0]!.dedupKey as string,
        pvsEventLogId: "log-1",
      })
    ).toBe(inserts[0]!.dedupKey);
  });

  it("different invoices, sources and clinics get different keys", () => {
    const a = invoiceDedupKey(CLINIC, "medatixx", "INV-7");
    expect(invoiceDedupKey(CLINIC, "medatixx", "INV-8")).not.toBe(a);
    expect(invoiceDedupKey(CLINIC, "gdt_agent", "INV-7")).not.toBe(a);
    expect(invoiceDedupKey("other", "medatixx", "INV-7")).not.toBe(a);
  });

  it("an InvoiceRefunded row never creates a Purchase conversion", async () => {
    eventRow = {
      kind: "InvoiceRefunded",
      bridgeSource: "medatixx",
      payload: { pvsInvoiceId: "INV-7" },
    };
    const res = await enqueueInvoiceConversions({ ...base, pvsEventLogId: "log-r" });
    expect(inserts).toHaveLength(0);
    expect(res.inserted).toEqual([]);
    expect(enqueueOci).not.toHaveBeenCalled();
  });

  it("pass 2: a zero-value invoice never creates a Purchase conversion", async () => {
    const res = await enqueueInvoiceConversions({ ...base, valueEur: 0, pvsEventLogId: "log-0" });
    expect(inserts).toHaveLength(0);
    expect(res.inserted).toEqual([]);
    expect(enqueueOci).not.toHaveBeenCalled();
  });

  it("without an invoice id it falls back to the legacy per-event key", async () => {
    eventRow = { kind: "InvoicePaid", bridgeSource: "medatixx", payload: {} };
    await enqueueInvoiceConversions({ ...base, pvsEventLogId: "log-9" });
    expect(inserts[0]!.dedupKey).toBe("purchase-req-1-log-9");
    expect(inserts[0]!.pvsInvoiceId).toBeNull();
    expect(
      conversionOrderId({ dedupKey: "purchase-req-1-log-9", pvsEventLogId: "log-9" })
    ).toBe("log-9");
  });
});
