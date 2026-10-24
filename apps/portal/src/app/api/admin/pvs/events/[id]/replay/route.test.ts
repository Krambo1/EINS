import { beforeEach, describe, expect, it, vi } from "vitest";

const CLINIC = "11111111-2222-3333-4444-555555555555";
const ID = "99999999-2222-3333-4444-555555555555";

let detail: Record<string, unknown> | null;
const applyMock = vi.fn();
const auditMock = vi.fn(async () => {});

vi.mock("@/auth/admin-guards", () => ({
  requireAdminForApi: async () => ({ ok: true, admin: { email: "op@eins.test" } }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => auditMock(...(a as [])) }));
vi.mock("@/server/queries/admin-pvs-events", () => ({
  getEventDetail: async () => detail,
}));
vi.mock("@/server/pvs-event-integrity", () => ({
  verifyPvsEventIntegrityTag: () => true,
}));
vi.mock("@/server/pvs-events", async () => {
  const { z } = await import("zod");
  return {
    applyPvsEvent: (...a: unknown[]) => applyMock(...a),
    PvsEventSchema: z.object({ clinicId: z.string() }).passthrough(),
  };
});

import { POST } from "./route";

function call(search = "") {
  return POST(
    new Request(`http://localhost/api/admin/pvs/events/${ID}/replay${search}`, {
      method: "POST",
    }) as never,
    { params: Promise.resolve({ id: ID }) }
  );
}

beforeEach(() => {
  applyMock.mockReset();
  auditMock.mockClear();
  detail = {
    id: ID,
    clinicId: CLINIC,
    pvsExternalEventId: "evt-1",
    payload: { kind: "InvoicePaid", clinicId: CLINIC },
    payloadSig: "sig",
  };
});

describe("POST /api/admin/pvs/events/[id]/replay", () => {
  it("rejects a payload that names a different clinic than the row", async () => {
    detail!.payload = { kind: "InvoicePaid", clinicId: "aaaaaaaa-2222-3333-4444-555555555555" };
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("clinic_mismatch");
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("rejects legacy unsigned rows unless allowLegacy=1", async () => {
    detail!.payloadSig = null;
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("legacy_unsigned");
    expect(applyMock).not.toHaveBeenCalled();

    applyMock.mockResolvedValue({ ok: true, status: "ingested", eventLogId: "n", linked: null });
    const ok = await call("?allowLegacy=1");
    expect(ok.status).toBe(200);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it("maps internal_error to 500 and other failures to 409", async () => {
    applyMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    expect((await call()).status).toBe(500);
    applyMock.mockResolvedValue({ ok: false, reason: "vendor_mismatch" });
    expect((await call()).status).toBe(409);
  });
});
