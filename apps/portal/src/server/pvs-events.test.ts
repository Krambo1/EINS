import { describe, it, expect } from "vitest";
import { PvsEventSchema } from "./pvs-events";

describe("pvs-events Zod schema", () => {
  const base = {
    clinicId: "11111111-2222-3333-4444-555555555555",
    bridgeSource: "tomedo" as const,
    pvsExternalEventId: "evt-1",
    occurredAt: "2026-05-18T10:30:00.000Z",
  };

  it("accepts a valid PatientUpserted", () => {
    const r = PvsEventSchema.safeParse({
      ...base,
      kind: "PatientUpserted",
      pvsPatientId: "P-1",
      email: "test@example.de",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid clinicId", () => {
    const r = PvsEventSchema.safeParse({
      ...base,
      clinicId: "not-a-uuid",
      kind: "PatientUpserted",
      pvsPatientId: "P-1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const r = PvsEventSchema.safeParse({
      ...base,
      kind: "FooBar",
      pvsPatientId: "P-1",
    });
    expect(r.success).toBe(false);
  });

  it("accepts InvoicePaid with integer cents only", () => {
    const ok = PvsEventSchema.safeParse({
      ...base,
      kind: "InvoicePaid",
      pvsPatientId: "P-1",
      pvsInvoiceId: "I-1",
      amountCents: 12500,
      paidAt: base.occurredAt,
    });
    expect(ok.success).toBe(true);

    const float = PvsEventSchema.safeParse({
      ...base,
      kind: "InvoicePaid",
      pvsPatientId: "P-1",
      pvsInvoiceId: "I-1",
      amountCents: 125.5,
      paidAt: base.occurredAt,
    });
    expect(float.success).toBe(false);

    const neg = PvsEventSchema.safeParse({
      ...base,
      kind: "InvoicePaid",
      pvsPatientId: "P-1",
      pvsInvoiceId: "I-1",
      amountCents: -100,
      paidAt: base.occurredAt,
    });
    expect(neg.success).toBe(false);
  });

  it("requires AppointmentStatusChanged.newStatus to be one of the enum values", () => {
    const r = PvsEventSchema.safeParse({
      ...base,
      kind: "AppointmentStatusChanged",
      pvsPatientId: "P-1",
      pvsAppointmentId: "A-1",
      newStatus: "rescheduled", // not in the enum
    });
    expect(r.success).toBe(false);
  });

  it("PatientMerged has both from/to required", () => {
    const r = PvsEventSchema.safeParse({
      ...base,
      kind: "PatientMerged",
      fromPvsPatientId: "P-1",
      toPvsPatientId: "P-2",
    });
    expect(r.success).toBe(true);
  });
});
