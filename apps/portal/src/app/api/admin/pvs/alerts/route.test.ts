import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminForApi, rows } = vi.hoisted(() => ({
  requireAdminForApi: vi.fn(),
  rows: { value: [] as unknown[] },
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
vi.mock("@/auth/admin-guards", () => ({
  requireAdminForApi: () => requireAdminForApi(),
}));
vi.mock("@/server/worker-heartbeat", () => ({
  WORKER_BEAT_NAME: "worker",
  getLastBeat: async () => new Date("2026-07-21T11:59:00Z"),
  isWorkerStale: () => false,
}));
vi.mock("@/db/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = async () => rows.value;
  return {
    db: { select: () => chain },
    schema: {
      dashboardAlerts: new Proxy({}, { get: (_t, k) => String(k) }),
      clinics: new Proxy({}, { get: (_t, k) => String(k) }),
    },
  };
});

const { GET } = await import("./route");

beforeEach(() => {
  rows.value = [];
});

describe("GET /api/admin/pvs/alerts", () => {
  it("returns the guard's 401 for a non-admin without touching the db", async () => {
    const denied = Response.json({ error: { code: "not_authenticated" } }, { status: 401 });
    requireAdminForApi.mockResolvedValue({ ok: false, response: denied });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists open PVS alerts across clinics plus worker liveness", async () => {
    requireAdminForApi.mockResolvedValue({ ok: true, admin: {} });
    rows.value = [{ id: "1", clinicId: "c1", kind: "pvs_agent_health", severity: "high" }];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.alerts[0].kind).toBe("pvs_agent_health");
    expect(body.worker).toEqual({ lastBeatAt: "2026-07-21T11:59:00.000Z", stale: false });
  });
});
