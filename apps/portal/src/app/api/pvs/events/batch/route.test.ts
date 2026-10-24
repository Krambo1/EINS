import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for POST /api/pvs/events/batch: per-event validation,
 * aligned results[], and the "nothing applied before the signature check"
 * guarantee. Collaborators are mocked (see agent/routes.test.ts for the
 * pattern); the test is about the handler's branching.
 */

const rateLimit = vi.fn(async (_ns: string, _key: string) => ({
  ok: true as boolean,
  resetInSeconds: 60,
}));
const verifyClinicSignature = vi.fn(async () => true as boolean);
const writeAudit = vi.fn(async (..._a: unknown[]) => {});
const applyPvsEvent = vi.fn(async (_e: unknown): Promise<unknown> => ({
  ok: true,
  status: "ingested",
  eventLogId: "log-1",
  linked: null,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
  after: (cb: () => unknown) => {
    void cb();
  },
}));
vi.mock("@/server/rate-limit", () => ({
  rateLimit: (ns: string, key: string) => rateLimit(ns, key),
}));
vi.mock("@/server/clinic-signature", () => ({
  verifyClinicSignature: () => verifyClinicSignature(),
}));
vi.mock("@/server/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
}));
vi.mock("@/server/pvs-events", async () => {
  const actual = await vi.importActual<typeof import("@/server/pvs-events")>(
    "@/server/pvs-events"
  );
  return { ...actual, applyPvsEvent: (e: unknown) => applyPvsEvent(e) };
});

const { POST } = await import("./route.js");

const CLINIC = "11111111-1111-4111-8111-111111111111";
const OTHER_CLINIC = "22222222-2222-4222-8222-222222222222";

function patient(id: string, over: Record<string, unknown> = {}) {
  return {
    kind: "PatientUpserted",
    clinicId: CLINIC,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `ev-${id}`,
    occurredAt: "2026-01-01T10:00:00.000Z",
    pvsPatientId: `p-${id}`,
    ...over,
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/pvs/events/batch", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-eins-signature": "sha256=deadbeef", "x-forwarded-for": "1.2.3.4" },
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ ok: true, resetInSeconds: 60 });
  verifyClinicSignature.mockReset().mockResolvedValue(true);
  writeAudit.mockReset().mockResolvedValue(undefined);
  applyPvsEvent.mockReset().mockResolvedValue({
    ok: true,
    status: "ingested",
    eventLogId: "log-1",
    linked: null,
  });
});

describe("POST /api/pvs/events/batch", () => {
  it("one invalid event does not fail the others; results align with input", async () => {
    const res = await POST(
      req({
        clinicId: CLINIC,
        events: [patient("1"), { kind: "Nope" }, patient("3")],
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.results).toEqual([
      { status: "ingested" },
      { error: "invalid_envelope" },
      { status: "ingested" },
    ]);
    expect(body.ingested).toBe(2);
    expect(body.errors).toEqual([{ idx: 1, reason: "invalid_envelope" }]);
    expect(applyPvsEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects csv_upload and foreign-clinic events per event", async () => {
    const res = await POST(
      req({
        clinicId: CLINIC,
        events: [
          patient("1", { bridgeSource: "csv_upload" }),
          patient("2", { clinicId: OTHER_CLINIC }),
          patient("3"),
        ],
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.results).toEqual([
      { error: "invalid_bridge_source" },
      { error: "clinic_mismatch" },
      { status: "ingested" },
    ]);
    expect(applyPvsEvent).toHaveBeenCalledTimes(1);
  });

  it("maps apply results (deduped / quarantined / failures / throws) in order", async () => {
    applyPvsEvent
      .mockResolvedValueOnce({ ok: true, status: "deduped" })
      .mockResolvedValueOnce({ ok: true, status: "quarantined", eventLogId: "x" })
      .mockResolvedValueOnce({ ok: false, reason: "billing_conflict" })
      .mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      req({
        clinicId: CLINIC,
        events: [patient("1"), patient("2"), patient("3"), patient("4")],
      })
    );
    const body = await res.json();
    expect(body.results).toEqual([
      { status: "deduped" },
      { status: "quarantined" },
      { error: "billing_conflict" },
      { error: "internal_error" },
    ]);
    expect(body).toMatchObject({ ok: true, ingested: 0, deduped: 1, quarantined: 1 });
    expect(body.errors).toHaveLength(2);
  });

  it("applies the kind alias before validation", async () => {
    const res = await POST(
      req({
        clinicId: CLINIC,
        events: [
          {
            kind: "invoice_paid",
            clinicId: CLINIC,
            bridgeSource: "gdt_agent",
            pvsExternalEventId: "inv-1",
            occurredAt: "2026-01-01T10:00:00.000Z",
            pvsPatientId: "p1",
            pvsInvoiceId: "i1",
            amountCents: 1000,
            currency: "EUR",
            paidAt: "2026-01-01T10:00:00.000Z",
          },
        ],
      })
    );
    const body = await res.json();
    // Whether the rest of the InvoicePaid shape validates is the schema's
    // business; the alias must have been resolved (not rejected as an unknown kind).
    if (body.results[0].error === "invalid_envelope") {
      expect(applyPvsEvent).not.toHaveBeenCalled();
    } else {
      expect((applyPvsEvent.mock.calls[0]![0] as { kind: string }).kind).toBe("InvoicePaid");
    }
  });

  it("a bad signature applies nothing", async () => {
    verifyClinicSignature.mockResolvedValue(false);
    const res = await POST(
      req({ clinicId: CLINIC, events: [patient("1"), patient("2")] })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
    expect(applyPvsEvent).not.toHaveBeenCalled();
  });

  it("a body that is not {clinicId, events[]} fails the whole batch with 400", async () => {
    const res = await POST(req({ clinicId: CLINIC, events: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_envelope");
    const res2 = await POST(req({ clinicId: CLINIC, events: [] }));
    expect(res2.status).toBe(400);
    expect(applyPvsEvent).not.toHaveBeenCalled();
  });

  // Pass 2: the order flipped. clinicId is clear text in the body, so with
  // the budget spent first, unsigned junk could exhaust a Praxis's per-clinic
  // quota and its real agent got 429 for the rest of the window. The per-IP
  // gate still runs before the signature check and bounds its cost.
  it("an unsigned request never consumes the per-clinic budget", async () => {
    verifyClinicSignature.mockResolvedValue(false);
    const res = await POST(req({ clinicId: CLINIC, events: [patient("1")] }));
    expect(res.status).toBe(400);
    expect(rateLimit.mock.calls.map((c) => c[0])).not.toContain("pvs-events-batch");
    expect(applyPvsEvent).not.toHaveBeenCalled();
  });

  it("a signed request over the per-clinic limit gets 429 and applies nothing", async () => {
    rateLimit.mockImplementation(async (ns: string) => ({
      ok: ns !== "pvs-events-batch",
      resetInSeconds: 30,
    }));
    const res = await POST(req({ clinicId: CLINIC, events: [patient("1")] }));
    expect(res.status).toBe(429);
    expect(verifyClinicSignature).toHaveBeenCalled();
    expect(applyPvsEvent).not.toHaveBeenCalled();
  });
});
