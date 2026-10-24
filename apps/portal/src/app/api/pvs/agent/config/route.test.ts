import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for POST /api/pvs/agent/config (0071).
 *
 * Same security control-flow as the other agent endpoints: per-IP gate, Zod
 * envelope, per-clinic gate, HMAC, symmetric generic failure. The one that
 * matters most is the last: an agent must not be able to pull a config its
 * Praxis was never targeted with, because that is how a pilot version escapes
 * its pilot.
 */

const rateLimit = vi.fn(async (_ns: string, _key: string) => ({
  ok: true as boolean,
  resetInSeconds: 60,
}));
const verifyClinicSignature = vi.fn(async () => true as boolean);
const writeAudit = vi.fn(async () => {});
const resolveBundles = vi.fn(
  async (_clinicId: string, _vendors: string[]) => [] as unknown[]
);

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
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
}));
vi.mock("@/server/pvs-vendor-config", () => ({
  resolveBundles: (clinicId: string, vendors: string[]) =>
    resolveBundles(clinicId, vendors),
}));

const { POST } = await import("./route.js");

const CLINIC = "11111111-1111-4111-8111-111111111111";

function req(body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/pvs/agent/config", {
    method: "POST",
    body: raw,
    headers: {
      "x-eins-signature": "deadbeef",
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "eins-agent/0.3.0",
      ...headers,
    },
  }) as unknown as Parameters<typeof POST>[0];
}

const validRequest = {
  clinicId: CLINIC,
  vendors: ["tomedo-db"],
  sentAt: 1_700_000_100_000,
};

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ ok: true, resetInSeconds: 60 });
  verifyClinicSignature.mockReset().mockResolvedValue(true);
  writeAudit.mockReset().mockResolvedValue(undefined);
  resolveBundles.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/pvs/agent/config", () => {
  it("returns the bundles the clinic is entitled to", async () => {
    resolveBundles.mockResolvedValue([{ vendor: "tomedo-db", version: 4 }]);
    const res = await POST(req(validRequest));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      configs: [{ vendor: "tomedo-db", version: 4 }],
    });
    expect(resolveBundles).toHaveBeenCalledWith(CLINIC, ["tomedo-db"]);
  });

  it("returns an empty list rather than an error when nothing is targeted", async () => {
    const res = await POST(req(validRequest));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ configs: [] });
    // Nothing delivered means nothing to audit.
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("audits an actual delivery", async () => {
    resolveBundles.mockResolvedValue([{ vendor: "tomedo-db" }]);
    await POST(req(validRequest));
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pvs_agent_config_deliver" })
    );
  });

  it("bad signature → 400 invalid_request, audits the reject, no lookup", async () => {
    verifyClinicSignature.mockResolvedValue(false);
    const res = await POST(req(validRequest));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(resolveBundles).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pvs_agent_config_reject" })
    );
  });

  it("non-uuid clinicId → 400 invalid_envelope before any signature work", async () => {
    const res = await POST(req({ ...validRequest, clinicId: "nope" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "invalid_envelope" },
    });
    expect(verifyClinicSignature).not.toHaveBeenCalled();
  });

  it("unparseable body → 400 invalid_request", async () => {
    const res = await POST(req("{not json"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
  });

  it("refuses an oversized vendor list", async () => {
    const res = await POST(
      req({ ...validRequest, vendors: Array.from({ length: 21 }, () => "x") })
    );
    expect(res.status).toBe(400);
    expect(resolveBundles).not.toHaveBeenCalled();
  });

  it("per-IP rate-limit exceeded → 429 with ip reason header", async () => {
    rateLimit.mockResolvedValueOnce({ ok: false, resetInSeconds: 30 });
    const res = await POST(req(validRequest));
    expect(res.status).toBe(429);
    expect(res.headers.get("X-PVS-RateLimit-Reason")).toBe("ip");
    expect(verifyClinicSignature).not.toHaveBeenCalled();
  });

  it("per-clinic rate-limit exceeded → 429 with clinic reason header", async () => {
    rateLimit
      .mockResolvedValueOnce({ ok: true, resetInSeconds: 60 })
      .mockResolvedValueOnce({ ok: false, resetInSeconds: 45 });
    const res = await POST(req(validRequest));
    expect(res.status).toBe(429);
    expect(res.headers.get("X-PVS-RateLimit-Reason")).toBe("clinic");
    expect(resolveBundles).not.toHaveBeenCalled();
  });

  it("a resolution failure is a 500, not a silent empty answer", async () => {
    // An empty list means "nothing to change" to the agent. Reporting a lookup
    // failure that way would make a broken portal look like a settled fleet.
    resolveBundles.mockRejectedValue(new Error("db down"));
    const res = await POST(req(validRequest));
    expect(res.status).toBe(500);
  });
});
