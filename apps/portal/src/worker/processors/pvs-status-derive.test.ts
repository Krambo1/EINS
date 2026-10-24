import { describe, expect, it } from "vitest";
import {
  aggregateRequestBuckets,
  appointmentIsRecentEnough,
  assignBucketsToRequests,
  clampActivityTimestamp,
  clampKpiRebuildRange,
  conversionsToSend,
  deriveStatusForBucket,
  foldEvents,
  isRefundExplained,
  revenueSwingExceedsThreshold,
  type RequestCandidate,
} from "./pvs-status-derive";

/** Build a fold input event. foldEvents reads payload.kind + the kind-specific
 *  fields only (it does not re-validate the Zod schema), so test payloads can
 *  omit the envelope baseFields. */
const ev = (payload: Record<string, unknown>, occurredAt: string, id: string) => ({
  id,
  kind: payload.kind as string,
  occurredAt: new Date(occurredAt),
  payload,
});

/**
 * P2-3 cascade-attribution alarm — predicate tests.
 *
 * The full applyToRequest / fanoutInvoiceConversions paths require a
 * live database (foreign keys, partition heal, pg-boss enqueue). They
 * are covered by integration tests in the staging soak environment.
 * Here we lock down the predicate behaviour so a future refactor can't
 * change the threshold logic without flipping these expectations.
 *
 * Why this matters: the predicate is the gate between "silently update
 * lifetime revenue" and "park the change in the dashboard alerts
 * queue for operator review". A subtle off-by-one (e.g. dropping the
 * €100 floor for prior=0) would either spam every first-invoice
 * patient with alerts, or miss real fuzzy-link errors entirely.
 */

describe("revenueSwingExceedsThreshold (P2-3)", () => {
  it("returns false when both prior and new are zero (no-op)", () => {
    expect(revenueSwingExceedsThreshold(0, 0)).toBe(false);
  });

  it("returns false when prior=0 and new is below the €100 floor", () => {
    // €0 → €99 is a normal first-invoice case, not alarming.
    expect(revenueSwingExceedsThreshold(0, 9_999)).toBe(false);
    // €0 → exactly €100 — borderline; trigger the alert since €100+
    // first-invoices are uncommon enough to be worth a manual look.
    expect(revenueSwingExceedsThreshold(0, 10_000)).toBe(true);
  });

  it("returns true when prior=0 and new is well above the €100 floor", () => {
    // €0 → €4,800 lifetime in one derive run smells like a wrong-
    // patient merge. Flag it.
    expect(revenueSwingExceedsThreshold(0, 480_000)).toBe(true);
  });

  it("does NOT alarm on small absolute swings even at low priors", () => {
    // €1 → €1.10: 10% swing, under the 20% threshold.
    expect(revenueSwingExceedsThreshold(100, 110)).toBe(false);
  });

  it("alarms on >20% relative swings", () => {
    // €5,000 → €3,900 (drop of 22%) — exactly the "linker absorbed
    // someone else's invoices and now took them back" pattern.
    expect(revenueSwingExceedsThreshold(500_000, 390_000)).toBe(true);
    // €5,000 → €6,001 (increase >20%) — equally suspicious.
    expect(revenueSwingExceedsThreshold(500_000, 600_100)).toBe(true);
  });

  it("does NOT alarm on the exact 20% boundary (strict-greater-than)", () => {
    // €5,000 → €6,000 (and €5,000 → €4,000) is exactly 20%. The
    // threshold uses >, not ≥, so routine seasonal swings near the
    // boundary don't trigger.
    expect(revenueSwingExceedsThreshold(500_000, 600_000)).toBe(false);
    expect(revenueSwingExceedsThreshold(500_000, 400_000)).toBe(false);
  });
});

describe("future occurredAt clamping (finding 8)", () => {
  const now = new Date("2026-05-28T12:00:00.000Z");

  it("clamps a future booking's lastSeenAt to now, never the future", () => {
    const future = new Date("2026-06-15T14:00:00.000Z"); // an appointment 3 wks out
    expect(clampActivityTimestamp(future, now)).toEqual(now);
  });

  it("keeps a past activity timestamp as-is", () => {
    const past = new Date("2026-05-25T09:00:00.000Z");
    expect(clampActivityTimestamp(past, now)).toEqual(past);
  });

  it("falls back to now when there are no events", () => {
    expect(clampActivityTimestamp(null, now)).toEqual(now);
  });

  it("clamps the KPI rebuild upper bound to today", () => {
    const range = clampKpiRebuildRange(
      new Date("2026-05-25T09:00:00.000Z"),
      new Date("2026-06-15T14:00:00.000Z"),
      now
    );
    expect(range).toEqual({ from: "2026-05-25", to: "2026-05-28" });
  });

  it("returns null when the whole range is in the future (nothing past to rebuild)", () => {
    const range = clampKpiRebuildRange(
      new Date("2026-06-10T09:00:00.000Z"),
      new Date("2026-06-15T14:00:00.000Z"),
      now
    );
    expect(range).toBeNull();
  });

  it("leaves an entirely-past range untouched", () => {
    const range = clampKpiRebuildRange(
      new Date("2026-05-20T09:00:00.000Z"),
      new Date("2026-05-27T14:00:00.000Z"),
      now
    );
    expect(range).toEqual({ from: "2026-05-20", to: "2026-05-27" });
  });
});

describe("foldEvents · #9 appt-less invoice attribution (play it safe)", () => {
  it("bridges an appt-less invoice to its appointment via pvsEncounterId", () => {
    const events = [
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e1"),
      ev({ kind: "EncounterCompleted", pvsEncounterId: "E1", pvsAppointmentId: "A1", completedAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e2"),
      // invoice carries the encounter id but NO appointment id:
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsEncounterId: "E1", amountCents: 50000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e3"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(50000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(50000);
    expect(deriveStatusForBucket(b.byAppt.get("A1")!)).toBe("gewonnen");
  });

  it("bridges even when the invoice sorts BEFORE its encounter (pre-scan)", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsEncounterId: "E1", amountCents: 30000, paidAt: "2026-05-18T10:00:00.000Z" }, "2026-05-18T10:00:00.000Z", "e1"),
      ev({ kind: "EncounterCompleted", pvsEncounterId: "E1", pvsAppointmentId: "A1", completedAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(30000);
  });

  it("never guesses an APPOINTMENT: a truly appt-less, no-encounter invoice gets its own synthetic bucket", () => {
    // Pass 2: it used to stay in the patient total only, so Honorar-CSV
    // revenue (no appointment ids) never reached a lead. It is now attributed
    // by date like any bucket (assignBucketsToRequests), but never invents an
    // appointment link.
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e1"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(40000);
    expect(b.byAppt.size).toBe(1);
    expect([...b.byAppt.values()][0]!.synthetic).toBe(true);
  });

  it("does not bridge when the encounter itself has no appointment", () => {
    const events = [
      ev({ kind: "EncounterCompleted", pvsEncounterId: "E1", completedAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsEncounterId: "E1", amountCents: 25000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(25000);
    // No real appointment bucket: only the invoice's synthetic one.
    expect([...b.byAppt.values()].every((x) => x.synthetic)).toBe(true);
  });
});

describe("foldEvents · #10 refund / storno netting", () => {
  it("nets the patient total and the bucket on a partial refund (stays gewonnen)", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", refundedAmountCents: 20000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(30000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(30000);
    expect(deriveStatusForBucket(b.byAppt.get("A1")!)).toBe("gewonnen");
  });

  it("a full refund drops the bucket below 'gewonnen'", () => {
    const events = [
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e0"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsAppointmentId: "A1", refundedAmountCents: 50000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(0);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(0);
    expect(deriveStatusForBucket(b.byAppt.get("A1")!)).not.toBe("gewonnen");
  });

  it("matches a refund to its appointment via pvsInvoiceId when the refund omits the appointment", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I9", pvsAppointmentId: "A9", amountCents: 12000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I9", refundedAmountCents: 12000, refundedAt: "2026-05-26T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.byAppt.get("A9")?.invoiceCents).toBe(0);
  });

  it("clamps to zero for a refund whose original invoice we never saw", () => {
    const events = [
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "GHOST", refundedAmountCents: 30000, refundedAt: "2026-05-26T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "e1"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(0);
  });
});

describe("foldEvents · H4 per-invoice-id dedup (no double-counting on re-emission)", () => {
  it("counts a re-emitted invoice ONCE, taking the amount from the latest occurredAt", () => {
    // Same pvsInvoiceId emitted twice (e.g. corrected payment date on re-export
    // shifts occurredAt into a new event-log row). The later row carries a
    // corrected amount and must win; the invoice is counted once, not summed.
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 60000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-22T09:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(60000); // latest amount, not 110000
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(60000);
    // Only one ads-conversion event survives (no duplicate Purchase upload).
    expect(b.byAppt.get("A1")?.invoiceEvents.length).toBe(1);
  });

  it("takes the latest occurredAt even when the re-emission sorts earlier in the input", () => {
    // Dedup keys on occurredAt, not array order, so an out-of-order replay still
    // resolves to the newest row.
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 60000, paidAt: "2026-05-22T10:00:00.000Z" }, "2026-05-22T09:00:00.000Z", "e2"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(60000);
  });

  it("sums two DIFFERENT invoice ids normally (installments, not a re-emission)", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I2", pvsAppointmentId: "A1", amountCents: 30000, paidAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(80000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(80000);
    expect(b.byAppt.get("A1")?.invoiceEvents.length).toBe(2);
  });

  it("keys the dedup per source system: same id from different bridgeSources stays distinct", () => {
    // pvsInvoiceId is only unique per PVS, so an identical id from two source
    // systems must NOT collapse into one invoice.
    const events = [
      ev({ kind: "InvoicePaid", bridgeSource: "tomedo", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", bridgeSource: "pabau", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 30000, paidAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(80000);
  });

  it("treats invoices without a pvsInvoiceId as unique (summed per row)", () => {
    // The schema requires pvsInvoiceId, but foldEvents doesn't re-validate; a
    // stripped id must fall back to per-row summing, never collapse to one.
    const events = [
      ev({ kind: "InvoicePaid", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsAppointmentId: "A1", amountCents: 30000, paidAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(80000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(80000);
    expect(b.byAppt.get("A1")?.invoiceEvents.length).toBe(2);
  });

  it("dedups a re-emitted refund and still nets the invoice once (refund netting intact)", () => {
    // Both the paid and the refund get re-emitted with shifted occurredAt. The
    // paid counts once at its latest amount, the refund subtracts once.
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e2"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", refundedAmountCents: 20000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "e3"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", refundedAmountCents: 20000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "e4"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(30000); // 50000 paid once - 20000 refunded once
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(30000);
    expect(deriveStatusForBucket(b.byAppt.get("A1")!)).toBe("gewonnen");
  });
});

describe("foldEvents · M-D6 dual-path revenue detection (defense in depth)", () => {
  it("collects the distinct continuous sources that contributed counted revenue, without suppressing either", () => {
    // The same treatment paid once, seen via both the GDT watcher and a DB
    // adapter: different bridge_source, different invoice keys, so neither
    // the event-log dedup nor the H4 per-invoice dedup can collapse them.
    // The fold must SURFACE this (revenueSources) but not guess which row
    // to drop — that is the operator's call via the dashboard alert.
    const events = [
      ev({ kind: "InvoicePaid", bridgeSource: "gdt_agent", pvsInvoiceId: "sha-abc", amountCents: 45000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", bridgeSource: "medatixx", pvsInvoiceId: "R-2026-77", amountCents: 45000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:05:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.revenueSources).toEqual(new Set(["gdt_agent", "medatixx"]));
    expect(b.invoiceTotalsCents).toBe(90000); // detection, not suppression
  });

  it("ignores universal sources — a CSV backfill next to a live adapter is legitimate", () => {
    const events = [
      ev({ kind: "InvoicePaid", bridgeSource: "csv_upload", pvsInvoiceId: "u1:12", amountCents: 30000, paidAt: "2025-11-02T10:00:00.000Z" }, "2025-11-02T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", bridgeSource: "medatixx", pvsInvoiceId: "R-2026-78", amountCents: 45000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.revenueSources).toEqual(new Set(["medatixx"]));
  });

  it("a single-path patient yields at most one source (never alerts)", () => {
    const events = [
      ev({ kind: "InvoicePaid", bridgeSource: "medatixx", pvsInvoiceId: "R-1", amountCents: 10000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", bridgeSource: "medatixx", pvsInvoiceId: "R-2", amountCents: 20000, paidAt: "2026-05-22T10:00:00.000Z" }, "2026-05-22T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.revenueSources).toEqual(new Set(["medatixx"]));
  });

  it("payloads without a bridgeSource (older test fixtures / stripped rows) contribute no source", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 10000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
    ];
    const b = foldEvents(events);
    expect(b.revenueSources.size).toBe(0);
  });
});

describe("foldEvents · orphan refunds (B2)", () => {
  it("a refund without a folded InvoicePaid never reduces revenue of OTHER invoices", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "NEW1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      // Refund of a pre-cutover invoice: no InvoicePaid for it in the log.
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "OLD", pvsAppointmentId: "A1", refundedAmountCents: 30000, refundedAt: "2026-05-26T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(50000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(50000);
  });

  it("a refund from a different bridgeSource than the payment is an orphan", () => {
    const events = [
      ev({ kind: "InvoicePaid", bridgeSource: "gdt_agent", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoiceRefunded", bridgeSource: "medatixx", pvsInvoiceId: "I1", refundedAmountCents: 50000, refundedAt: "2026-05-26T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "e2"),
    ];
    expect(foldEvents(events).invoiceTotalsCents).toBe(50000);
  });
});

describe("foldEvents · latest-wins tie-break (B3)", () => {
  it("equal occurredAt: the higher event log id wins, whatever the row order", () => {
    const at = "2026-05-20T10:00:00.000Z";
    const stale = ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 10000, paidAt: at }, at, "aaa");
    const fixed = ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 12000, paidAt: at }, at, "bbb");
    expect(foldEvents([stale, fixed]).invoiceTotalsCents).toBe(12000);
    expect(foldEvents([fixed, stale]).invoiceTotalsCents).toBe(12000);
  });

  it("equal occurredAt: the LATER insert (ingestedAt) wins over a higher random id", () => {
    const at = "2026-05-20T10:00:00.000Z";
    // The corrected re-export was ingested later but happens to get a
    // lexically SMALLER uuid: ingestedAt must decide, not the id.
    const stale = {
      ...ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 10000, paidAt: at }, at, "fff"),
      ingestedAt: new Date("2026-05-20T10:05:00.000Z"),
    };
    const fixed = {
      ...ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 12000, paidAt: at }, at, "000"),
      ingestedAt: new Date("2026-06-02T08:00:00.000Z"),
    };
    expect(foldEvents([stale, fixed]).invoiceTotalsCents).toBe(12000);
    expect(foldEvents([fixed, stale]).invoiceTotalsCents).toBe(12000);
  });
});

describe("appointmentIsRecentEnough (B4)", () => {
  const bucket = (scheduledAt: string | null) =>
    ({
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      completedAt: null,
      earliestInvoiceAt: null,
      noShowAt: null,
    }) as unknown as Parameters<typeof appointmentIsRecentEnough>[0];
  const created = new Date("2026-05-10T12:00:00.000Z");

  it("rejects a 2019 appointment for a brand-new lead", () => {
    expect(appointmentIsRecentEnough(bucket("2019-03-01T09:00:00.000Z"), created)).toBe(false);
  });
  it("accepts an appointment after the lead was created and within 1 day before", () => {
    expect(appointmentIsRecentEnough(bucket("2026-05-20T09:00:00.000Z"), created)).toBe(true);
    expect(appointmentIsRecentEnough(bucket("2026-05-09T13:00:00.000Z"), created)).toBe(true);
    expect(appointmentIsRecentEnough(bucket("2026-05-09T11:00:00.000Z"), created)).toBe(false);
  });
  it("an undated bucket cannot be shown to be recent", () => {
    expect(appointmentIsRecentEnough(bucket(null), created)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Pass 2 (2026-10-07): attribution + refunds + status corrections
// ---------------------------------------------------------------

const req = (id: string, createdAt: string | null, extra: Partial<RequestCandidate> = {}): RequestCandidate => ({
  id,
  createdAt: createdAt ? new Date(createdAt) : null,
  pvsAppointmentId: null,
  status: "neu",
  ...extra,
});

describe("pass 2 · several appointments of one lead all count", () => {
  it("a consultation and a later treatment appointment both land on the lead (revenue sums)", () => {
    const events = [
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 100000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e2"),
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A2", scheduledAt: "2026-06-10T09:00:00.000Z" }, "2026-06-01T09:00:00.000Z", "e3"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I2", pvsAppointmentId: "A2", amountCents: 200000, paidAt: "2026-06-10T10:00:00.000Z" }, "2026-06-10T10:00:00.000Z", "e4"),
    ];
    const b = foldEvents(events);
    // The lead already carries A1 from an earlier derive run: before pass 2
    // A2 found no request (A1's request was excluded) and its 2000 EUR vanished.
    const assigned = assignBucketsToRequests(
      [...b.byAppt.values()],
      [req("R1", "2026-05-15T12:00:00.000Z", { pvsAppointmentId: "A1" })]
    );
    expect(assigned.get("R1")?.map((x) => x.pvsAppointmentId).sort()).toEqual(["A1", "A2"]);
    const agg = aggregateRequestBuckets(assigned.get("R1")!);
    expect(agg.invoiceCents).toBe(300000);
    expect(agg.status).toBe("gewonnen");
    expect(agg.wonAt?.toISOString()).toBe("2026-05-20T10:00:00.000Z");
  });

  it("each appointment goes to the lead that existed at its date", () => {
    const events = [
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-02-10T09:00:00.000Z" }, "2026-02-01T09:00:00.000Z", "e1"),
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A2", scheduledAt: "2026-07-10T09:00:00.000Z" }, "2026-07-01T09:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    const assigned = assignBucketsToRequests([...b.byAppt.values()], [
      req("OLD", "2026-02-01T12:00:00.000Z"),
      req("NEW", "2026-07-05T12:00:00.000Z"),
    ]);
    expect(assigned.get("OLD")?.map((x) => x.pvsAppointmentId)).toEqual(["A1"]);
    expect(assigned.get("NEW")?.map((x) => x.pvsAppointmentId)).toEqual(["A2"]);
  });

  it("an appointment already linked to a request stays on it, even a different patient's", () => {
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e1"),
    ]);
    const assigned = assignBucketsToRequests(
      [...b.byAppt.values()],
      [req("MINE", "2026-05-18T12:00:00.000Z")],
      [req("LINKED", "2026-01-01T12:00:00.000Z", { pvsAppointmentId: "A1" })]
    );
    expect(assigned.get("LINKED")?.length).toBe(1);
    expect(assigned.has("MINE")).toBe(false);
  });

  it("spam requests never receive PVS revenue", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 50000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e1"),
    ]);
    const assigned = assignBucketsToRequests([...b.byAppt.values()], [
      req("SPAM", "2026-05-20T12:00:00.000Z", { status: "spam" }),
    ]);
    expect(assigned.size).toBe(0);
  });

  it("status is the furthest stage across the lead's appointments", () => {
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e1"),
      ev({ kind: "AppointmentStatusChanged", pvsAppointmentId: "A1", newStatus: "no_show" }, "2026-05-20T09:30:00.000Z", "e2"),
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A2", scheduledAt: "2026-05-27T09:00:00.000Z" }, "2026-05-21T09:00:00.000Z", "e3"),
    ]);
    expect(aggregateRequestBuckets([...b.byAppt.values()]).status).toBe("termin_vereinbart");
  });
});

describe("pass 2 · invoices without an appointment reach the lead", () => {
  it("an invoice with no appointment and no encounter becomes its own bucket on the recent lead", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", bridgeSource: "gdt_agent", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e1"),
    ]);
    expect(b.invoiceTotalsCents).toBe(40000);
    const buckets = [...b.byAppt.values()];
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.synthetic).toBe(true);
    const assigned = assignBucketsToRequests(buckets, [req("R1", "2026-05-10T12:00:00.000Z")]);
    const agg = aggregateRequestBuckets(assigned.get("R1")!);
    expect(agg.status).toBe("gewonnen");
    expect(agg.invoiceCents).toBe(40000);
    // A synthetic bucket never becomes the request's PVS appointment.
    expect(agg.primary).toBeNull();
  });

  it("never attaches a payment made before the lead existed", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2025-11-02T10:00:00.000Z" }, "2025-11-02T10:00:00.000Z", "e1"),
    ]);
    const assigned = assignBucketsToRequests([...b.byAppt.values()], [req("R1", "2026-05-10T12:00:00.000Z")]);
    expect(assigned.size).toBe(0);
  });
});

describe("pass 2 · refunds", () => {
  const paid = ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 100000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "p1");

  it("two distinct partial refunds (own pvsRefundId) of one invoice are summed", () => {
    const b = foldEvents([
      paid,
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsRefundId: "GS1", refundedAmountCents: 20000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "r1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsRefundId: "GS2", refundedAmountCents: 30000, refundedAt: "2026-05-28T10:00:00.000Z" }, "2026-05-28T10:00:00.000Z", "r2"),
    ]);
    expect(b.invoiceTotalsCents).toBe(50000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(50000);
    expect(b.byAppt.get("A1")?.refundedCents).toBe(50000);
  });

  it("verifier: a CSV credit (no refund id) older than the latest net invoice is not subtracted again", () => {
    // Oct export +1000 (rev 1); Nov export holds only the -300 credit (rev 2);
    // an Oct+Nov export nets the invoice to 700 (rev 3). The 700 already
    // contains the credit: subtracting it again gave 400.
    const b = foldEvents([
      ev({ kind: "InvoicePaid", bridgeSource: "gdt_agent", pvsInvoiceId: "X", amountCents: 100000, paidAt: "2026-10-05T10:00:00.000Z", sourceRevision: 1 }, "2026-10-05T10:00:00.000Z", "p1"),
      ev({ kind: "InvoiceRefunded", bridgeSource: "gdt_agent", pvsInvoiceId: "X", refundedAmountCents: 30000, refundedAt: "2026-11-03T10:00:00.000Z", sourceRevision: 2 }, "2026-11-03T10:00:00.000Z", "r1"),
      ev({ kind: "InvoicePaid", bridgeSource: "gdt_agent", pvsInvoiceId: "X", amountCents: 70000, paidAt: "2026-11-03T10:00:00.000Z", sourceRevision: 3 }, "2026-11-03T10:00:00.000Z", "p2"),
    ]);
    expect(b.invoiceTotalsCents).toBe(70000);
  });

  it("verifier: a CSV credit newer than the latest invoice version still nets it", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", bridgeSource: "gdt_agent", pvsInvoiceId: "X", amountCents: 100000, paidAt: "2026-10-05T10:00:00.000Z", sourceRevision: 1 }, "2026-10-05T10:00:00.000Z", "p1"),
      ev({ kind: "InvoiceRefunded", bridgeSource: "gdt_agent", pvsInvoiceId: "X", refundedAmountCents: 30000, refundedAt: "2026-11-03T10:00:00.000Z", sourceRevision: 2 }, "2026-11-03T10:00:00.000Z", "r1"),
    ]);
    expect(b.invoiceTotalsCents).toBe(70000);
  });

  it("a credit note with its own refund id is always netted, even before a later invoice version", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "X", amountCents: 100000, paidAt: "2026-10-05T10:00:00.000Z" }, "2026-10-05T10:00:00.000Z", "p1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "X", pvsRefundId: "GS1", refundedAmountCents: 30000, refundedAt: "2026-11-03T10:00:00.000Z" }, "2026-11-03T10:00:00.000Z", "r1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "X", amountCents: 100000, paidAt: "2026-11-05T10:00:00.000Z" }, "2026-11-05T10:00:00.000Z", "p2"),
    ]);
    expect(b.invoiceTotalsCents).toBe(70000);
  });

  it("a corrected version of the same refund id replaces, not adds", () => {
    const b = foldEvents([
      paid,
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsRefundId: "GS1", refundedAmountCents: 20000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "r1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsRefundId: "GS1", refundedAmountCents: 25000, refundedAt: "2026-05-26T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "r2"),
    ]);
    expect(b.invoiceTotalsCents).toBe(75000);
  });

  it("refunds of one invoice never eat another invoice's revenue (clamped per invoice)", () => {
    const b = foldEvents([
      paid,
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I2", pvsAppointmentId: "A1", amountCents: 30000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "p2"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsRefundId: "GS1", refundedAmountCents: 80000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "r1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", pvsRefundId: "GS2", refundedAmountCents: 80000, refundedAt: "2026-05-26T10:00:00.000Z" }, "2026-05-26T10:00:00.000Z", "r2"),
    ]);
    expect(b.invoiceTotalsCents).toBe(30000);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(30000);
  });

  it("a refund of an appointment-less invoice nets that invoice's own bucket", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "p1"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", refundedAmountCents: 40000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "r1"),
    ]);
    const agg = aggregateRequestBuckets([...b.byAppt.values()]);
    expect(agg.invoiceCents).toBe(0);
    expect(agg.refundedCents).toBe(40000);
  });

  it("a full refund is refund-explained (the downgrade is applied, revenue written as 0)", () => {
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e0"),
      ev({ kind: "EncounterCompleted", pvsEncounterId: "E1", pvsAppointmentId: "A1", completedAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      paid,
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", refundedAmountCents: 100000, refundedAt: "2026-05-25T10:00:00.000Z" }, "2026-05-25T10:00:00.000Z", "r1"),
    ]);
    const agg = aggregateRequestBuckets([...b.byAppt.values()]);
    expect(agg.status).toBe("behandelt");
    expect(isRefundExplained(agg)).toBe(true);
  });

  it("a storno re-emitted as amount 0 (CSV invoice book) is refund-explained", () => {
    // CSV exports carry no refund document: a cancelled invoice just shows
    // 0 € on the next export, and the agent re-emits the invoice with 0.
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e0"),
      paid,
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 0, paidAt: "2026-05-20T10:00:00.000Z", sourceRevision: 2 }, "2026-05-20T10:00:00.000Z", "p2"),
    ]);
    expect(b.invoiceTotalsCents).toBe(0);
    const agg = aggregateRequestBuckets([...b.byAppt.values()]);
    expect(agg.invoiceCents).toBe(0);
    expect(agg.refundedCents).toBe(100000);
    expect(isRefundExplained(agg)).toBe(true);
    expect(conversionsToSend([...b.byAppt.values()])).toEqual([]);
  });

  it("a lowered amount keeps the lower revenue and records the drop", () => {
    const b = foldEvents([
      paid,
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 60000, paidAt: "2026-05-20T10:00:00.000Z", sourceRevision: 2 }, "2026-05-20T10:00:00.000Z", "p2"),
    ]);
    expect(b.byAppt.get("A1")?.invoiceCents).toBe(60000);
    expect(b.byAppt.get("A1")?.refundedCents).toBe(40000);
    expect(isRefundExplained(aggregateRequestBuckets([...b.byAppt.values()]))).toBe(false);
  });

  it("a payment that was never there is NOT refund-explained", () => {
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e0"),
    ]);
    expect(isRefundExplained(aggregateRequestBuckets([...b.byAppt.values()]))).toBe(false);
  });
});

describe("pass 2 · appointment status corrections", () => {
  it("a no-show corrected to checked_in is no longer a no-show", () => {
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e0"),
      ev({ kind: "AppointmentStatusChanged", pvsAppointmentId: "A1", newStatus: "no_show" }, "2026-05-20T09:20:00.000Z", "e1"),
      ev({ kind: "AppointmentStatusChanged", pvsAppointmentId: "A1", newStatus: "checked_in" }, "2026-05-20T09:25:00.000Z", "e2"),
    ]);
    const bucket = b.byAppt.get("A1")!;
    expect(deriveStatusForBucket(bucket)).toBe("beratung_erschienen");
    expect(bucket.noShowAt).toBeNull();
  });

  it("status 'completed' without an EncounterCompleted is behandelt", () => {
    const b = foldEvents([
      ev({ kind: "AppointmentCreated", pvsAppointmentId: "A1", scheduledAt: "2026-05-20T09:00:00.000Z" }, "2026-05-19T09:00:00.000Z", "e0"),
      ev({ kind: "AppointmentStatusChanged", pvsAppointmentId: "A1", newStatus: "completed" }, "2026-05-20T11:00:00.000Z", "e1"),
    ]);
    expect(deriveStatusForBucket(b.byAppt.get("A1")!)).toBe("behandelt");
  });
});

describe("pass 2 · ads conversions", () => {
  it("a zero-amount invoice and a fully refunded invoice are never sent as a purchase", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I0", pvsAppointmentId: "A1", amountCents: 0, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "p0"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsAppointmentId: "A1", amountCents: 50000, paidAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:01.000Z", "p1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I2", pvsAppointmentId: "A1", amountCents: 30000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "p2"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I2", refundedAmountCents: 30000, refundedAt: "2026-05-22T10:00:00.000Z" }, "2026-05-22T10:00:00.000Z", "r2"),
      ev({ kind: "InvoiceRefunded", pvsInvoiceId: "I1", refundedAmountCents: 10000, refundedAt: "2026-05-22T10:00:00.000Z" }, "2026-05-22T11:00:00.000Z", "r1"),
    ]);
    const sends = conversionsToSend([...b.byAppt.values()]);
    expect(sends.map((s) => [s.eventLogId, s.valueCents])).toEqual([["p1", 40000]]);
  });
});

describe("pass 2 · attribution is stable when a later lead appears", () => {
  it("a lead that existed before the payment keeps it over one created in the 1-day slack", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e1"),
    ]);
    const assigned = assignBucketsToRequests([...b.byAppt.values()], [
      req("EARLY", "2026-05-01T12:00:00.000Z"),
      req("EVENING", "2026-05-21T20:00:00.000Z"),
    ]);
    expect([...assigned.keys()]).toEqual(["EARLY"]);
  });

  it("the slack still applies when no earlier lead exists", () => {
    const b = foldEvents([
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e1"),
    ]);
    const assigned = assignBucketsToRequests([...b.byAppt.values()], [
      req("EVENING", "2026-05-21T20:00:00.000Z"),
    ]);
    expect([...assigned.keys()]).toEqual(["EVENING"]);
  });
});
