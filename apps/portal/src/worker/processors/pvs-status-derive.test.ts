import { describe, expect, it } from "vitest";
import {
  clampActivityTimestamp,
  clampKpiRebuildRange,
  deriveStatusForBucket,
  foldEvents,
  revenueSwingExceedsThreshold,
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
 * live database (foreign keys, partition heal, BullMQ enqueue). They
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

  it("never guesses: a truly appt-less, no-encounter invoice stays in patient total only", () => {
    const events = [
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", amountCents: 40000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e1"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(40000); // visible at the patient aggregate
    expect(b.byAppt.size).toBe(0); // but never attached to a request/campaign
  });

  it("does not bridge when the encounter itself has no appointment", () => {
    const events = [
      ev({ kind: "EncounterCompleted", pvsEncounterId: "E1", completedAt: "2026-05-20T10:00:00.000Z" }, "2026-05-20T10:00:00.000Z", "e1"),
      ev({ kind: "InvoicePaid", pvsInvoiceId: "I1", pvsEncounterId: "E1", amountCents: 25000, paidAt: "2026-05-21T10:00:00.000Z" }, "2026-05-21T10:00:00.000Z", "e2"),
    ];
    const b = foldEvents(events);
    expect(b.invoiceTotalsCents).toBe(25000);
    expect(b.byAppt.size).toBe(0);
  });
});
