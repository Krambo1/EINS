import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for the PVS GDT-Agent telemetry endpoints (P2-2):
 *   POST /api/pvs/agent/heartbeat
 *   POST /api/pvs/agent/failure-summary
 *
 * These exercise the security control-flow each handler shares with
 * /api/pvs/events: per-IP + per-clinic rate limit, Zod envelope, HMAC
 * signature gate, symmetric generic failure, and the DB write. We mock the
 * collaborators (db, signature, rate-limit, audit) so the test is about the
 * handler's branching, not Postgres. `next/server` is mocked with a minimal
 * NextResponse (web `Response.json`) + a synchronous `after` so deferred
 * audit writes are observable.
 */

// ---- Mocks (hoisted) ---------------------------------------------------

const rateLimit = vi.fn(async (_ns: string, _key: string) => ({
  ok: true as boolean,
  resetInSeconds: 60,
}));
const verifyClinicSignature = vi.fn(async () => true as boolean);
const writeAudit = vi.fn(async () => {});

// Records of DB writes the handlers performed.
const upserts: Array<{ table: string; vals: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; vals: Record<string, unknown> }> = [];

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
  // Run the deferred callback synchronously so audit writes are visible to
  // assertions within the same tick.
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
vi.mock("@/db/client", () => ({
  db: {
    insert: (table: { __name: string }) => ({
      values: (vals: Record<string, unknown>) => ({
        onConflictDoUpdate: (_spec: unknown) => {
          upserts.push({ table: table.__name, vals });
          return Promise.resolve();
        },
        returning: (_proj: unknown) => {
          inserts.push({ table: table.__name, vals });
          return Promise.resolve([{ id: "fs-id-1" }]);
        },
      }),
    }),
  },
  schema: {
    pvsAgentStatus: { __name: "pvs_agent_status", clinicId: "clinicId" },
    pvsAgentFailureSummary: { __name: "pvs_agent_failure_summary", id: "id" },
    pvsLinkSource: {
      __name: "pvs_link_source",
      clinicId: "clinicId",
      bridgeSource: "bridgeSource",
    },
  },
}));

// Import the handlers AFTER the mocks are registered.
const { POST: heartbeatPOST } = await import("./heartbeat/route.js");
const { POST: failureSummaryPOST } = await import("./failure-summary/route.js");

const CLINIC = "11111111-1111-4111-8111-111111111111";

function req(body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/pvs/agent", {
    method: "POST",
    body: raw,
    headers: {
      "x-eins-signature": "deadbeef",
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "eins-agent/0.2.0",
      ...headers,
    },
  }) as unknown as Parameters<typeof heartbeatPOST>[0];
}

const validHeartbeat = {
  clinicId: CLINIC,
  agentVersion: "0.2.0",
  failedCount: 3,
  oldestFailedAt: 1_700_000_000_000,
  lastFailureReason: "http 503",
  recentReasons: [{ reason: "http 503", count: 3 }],
  sentAt: 1_700_000_100_000,
};

const validFailureSummary = {
  clinicId: CLINIC,
  prunedCount: 42,
  prunedOldestAt: 1_690_000_000_000,
  prunedNewestAt: 1_700_000_000_000,
  reasons: [{ reason: "http 503", count: 40 }],
  sentAt: 1_700_000_100_000,
};

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ ok: true, resetInSeconds: 60 });
  verifyClinicSignature.mockReset().mockResolvedValue(true);
  writeAudit.mockReset().mockResolvedValue(undefined);
  upserts.length = 0;
  inserts.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/pvs/agent/heartbeat", () => {
  it("valid signed payload → 200 and upserts pvs_agent_status", async () => {
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe("pvs_agent_status");
    expect(upserts[0].vals).toMatchObject({
      clinicId: CLINIC,
      failedEvents: 3,
      agentVersion: "0.2.0",
    });
  });

  it("bad signature → 400 invalid_request, audits the reject, no DB write", async () => {
    verifyClinicSignature.mockResolvedValue(false);
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(upserts).toHaveLength(0);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pvs_agent_heartbeat_reject" })
    );
  });

  it("invalid envelope (non-uuid clinicId) → 400 invalid_envelope", async () => {
    const res = await heartbeatPOST(
      req({ ...validHeartbeat, clinicId: "not-a-uuid" })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "invalid_envelope" },
    });
    expect(verifyClinicSignature).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400 invalid_request", async () => {
    const res = await heartbeatPOST(req("{not json"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
  });

  it("failedCount > 100 → 200 plus a dead-letter alert audit", async () => {
    const res = await heartbeatPOST(
      req({ ...validHeartbeat, failedCount: 250 })
    );
    expect(res.status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pvs_agent_dead_letter_alert" })
    );
  });

  it("clinic rate-limit exceeded → 429 with clinic reason header", async () => {
    // First call (per-IP) ok, second call (per-clinic) blocked.
    rateLimit
      .mockResolvedValueOnce({ ok: true, resetInSeconds: 60 })
      .mockResolvedValueOnce({ ok: false, resetInSeconds: 30 });
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(429);
    expect(res.headers.get("X-PVS-RateLimit-Reason")).toBe("clinic");
    expect(upserts).toHaveLength(0);
  });

  it("no enrolledVendors → only the pvs_agent_status upsert (no source write)", async () => {
    // Back-compat: an older agent omits the field, so the common heartbeat
    // stays a single write.
    await heartbeatPOST(req(validHeartbeat));
    expect(upserts).toHaveLength(1);
    expect(upserts.some((u) => u.table === "pvs_link_source")).toBe(false);
  });

  it("enrolledVendors → batched upsert into pvs_link_source (Phase 7)", async () => {
    const res = await heartbeatPOST(
      req({ ...validHeartbeat, enrolledVendors: ["gdt_agent", "medatixx"] })
    );
    expect(res.status).toBe(200);
    // One upsert for pvs_agent_status, one batched upsert for pvs_link_source.
    expect(upserts).toHaveLength(2);
    const sourceUpsert = upserts.find((u) => u.table === "pvs_link_source");
    expect(sourceUpsert).toBeDefined();
    expect(sourceUpsert!.vals).toEqual([
      expect.objectContaining({
        clinicId: CLINIC,
        bridgeSource: "gdt_agent",
        pvsVendor: "gdt_agent",
        enrolledVia: "heartbeat",
      }),
      expect.objectContaining({
        clinicId: CLINIC,
        bridgeSource: "medatixx",
        pvsVendor: "medatixx",
        enrolledVia: "heartbeat",
      }),
    ]);
  });

  it("an unknown enrolledVendors value → 400 invalid_envelope, no DB write", async () => {
    const res = await heartbeatPOST(
      req({ ...validHeartbeat, enrolledVendors: ["totally_made_up"] })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "invalid_envelope" },
    });
    expect(upserts).toHaveLength(0);
  });
});

describe("POST /api/pvs/agent/failure-summary", () => {
  it("valid signed payload → 201 with id and appends a row", async () => {
    const res = await failureSummaryPOST(req(validFailureSummary));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, id: "fs-id-1" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("pvs_agent_failure_summary");
    expect(inserts[0].vals).toMatchObject({ clinicId: CLINIC, prunedCount: 42 });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pvs_agent_failure_summary" })
    );
  });

  it("bad signature → 400 invalid_request, audits reject, no DB write", async () => {
    verifyClinicSignature.mockResolvedValue(false);
    const res = await failureSummaryPOST(req(validFailureSummary));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(inserts).toHaveLength(0);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pvs_agent_failure_summary_reject" })
    );
  });

  it("invalid envelope (negative prunedCount) → 400 invalid_envelope", async () => {
    const res = await failureSummaryPOST(
      req({ ...validFailureSummary, prunedCount: -1 })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "invalid_envelope" },
    });
    expect(inserts).toHaveLength(0);
  });

  it("per-IP rate-limit exceeded → 429 with ip reason header", async () => {
    rateLimit.mockResolvedValueOnce({ ok: false, resetInSeconds: 30 });
    const res = await failureSummaryPOST(req(validFailureSummary));
    expect(res.status).toBe(429);
    expect(res.headers.get("X-PVS-RateLimit-Reason")).toBe("ip");
    expect(inserts).toHaveLength(0);
  });
});
