import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getLastBeat, notifyOps, migrationStatus } = vi.hoisted(() => ({
  execute: vi.fn(),
  getLastBeat: vi.fn(),
  notifyOps: vi.fn(),
  migrationStatus: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
  after: (cb: () => unknown) => {
    void cb();
  },
}));
vi.mock("@/db/client", () => ({
  db: { execute: (q: unknown) => execute(q) },
  dbApp: { execute: async () => [{ statement_timeout: "15s" }] },
  assertAppRoleIsRlsSubject: async () => {},
}));
vi.mock("@/server/migration-status", () => ({
  migrationStatus: () => migrationStatus(),
}));
vi.mock("@/lib/env", () => ({
  configSummary: () => ({ email: true, storage: false }),
}));
vi.mock("@/server/worker-heartbeat", async () => {
  const actual = await vi.importActual<typeof import("@/server/worker-heartbeat")>(
    "@/server/worker-heartbeat"
  );
  return { ...actual, getLastBeat: (n: string) => getLastBeat(n) };
});
vi.mock("@/server/ops-alerts", () => ({
  notifyOps: (a: unknown) => notifyOps(a),
}));

const { GET } = await import("./route");

beforeEach(() => {
  execute.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  getLastBeat.mockReset();
  notifyOps.mockReset().mockResolvedValue("sent");
  migrationStatus.mockReset().mockResolvedValue("ok");
});

describe("GET /api/health", () => {
  it("200 when the worker beat is fresh", async () => {
    getLastBeat.mockResolvedValue(new Date(Date.now() - 60_000));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks.worker).toBe("ok");
    expect(body.reason).toBeUndefined();
    expect(notifyOps).not.toHaveBeenCalled();
  });

  it("503 worker_stale when the last beat is older than 10 minutes, without leaking the timestamp", async () => {
    const beat = new Date(Date.now() - 11 * 60_000);
    getLastBeat.mockResolvedValue(beat);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("worker_stale");
    expect(body.checks.worker).toBe("worker_stale");
    expect(JSON.stringify(body)).not.toContain(beat.toISOString());
    expect(notifyOps).toHaveBeenCalledTimes(1);
    expect(notifyOps.mock.calls[0]![0]).toMatchObject({
      clinicId: null,
      kind: "worker_stale",
      severity: "high",
    });
  });

  it("stays 200 when no beat was ever written (worker not deployed yet)", async () => {
    getLastBeat.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("does not consult the worker when the DB is down", async () => {
    execute.mockRejectedValue(new Error("db_down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(getLastBeat).not.toHaveBeenCalled();
    const body = await res.json();
    // Fixed code, never the driver message (public probe).
    expect(body.checks.db).toBe("db_error");
  });

  it("503 when the DB has not applied all shipped migrations", async () => {
    getLastBeat.mockResolvedValue(null);
    migrationStatus.mockResolvedValue("pending");
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).checks.migrations).toBe("pending");
  });

  it("stays 200 when the migration folder is not in the bundle, and reports config as booleans", async () => {
    getLastBeat.mockResolvedValue(null);
    migrationStatus.mockResolvedValue("unknown");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks.migrations).toBeUndefined();
    expect(body.info).toEqual({ migrations: "unknown", statementTimeout: "15s" });
    expect(body.config).toEqual({ email: true, storage: false });
  });
});
