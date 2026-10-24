import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconcile, notifyOps, execute, state } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  notifyOps: vi.fn(),
  execute: vi.fn(),
  state: { rows: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({ leftJoin: async () => state.rows }),
    }),
    execute: (q: unknown) => execute(q),
  },
  schema: {
    pvsAgentStatus: new Proxy({}, { get: (_t, k) => String(k) }),
    pvsLink: new Proxy({}, { get: (_t, k) => String(k) }),
  },
}));
vi.mock("@/server/ops-alerts", () => ({
  notifyOps: (a: unknown) => notifyOps(a),
}));
vi.mock("@/server/pvs-agent-health", async () => {
  const actual = await vi.importActual<typeof import("@/server/pvs-agent-health")>(
    "@/server/pvs-agent-health"
  );
  return {
    ...actual,
    reconcileAgentHealthAlerts: (...a: unknown[]) => reconcile(...a),
  };
});

const { processPvsAgentHealthScan } = await import("./pvs-agent-health-scan");

const now = Date.now();
const row = (clinicId: string, over: Record<string, unknown> = {}) => ({
  clinicId,
  linkStatus: "connected",
  lastHeartbeatAt: new Date(now - 30_000),
  lastEventAt: new Date(now - 3_600_000),
  agentFirstSeenAt: new Date(now - 90 * 86_400_000),
  firstHeartbeatAt: new Date(now - 90 * 86_400_000),
  stalePendingEvents: 0,
  missingFolders: [],
  dbAdaptersFailed: null,
  adapterStatuses: [],
  clockSkewSeconds: 0,
  ...over,
});

beforeEach(() => {
  reconcile.mockReset().mockResolvedValue(undefined);
  notifyOps.mockReset().mockResolvedValue("sent");
  execute.mockReset().mockResolvedValue([{ n: 0 }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("processPvsAgentHealthScan", () => {
  it("resolves when every clinic reconciles", async () => {
    state.rows = [row("a"), row("b")];
    await expect(processPvsAgentHealthScan()).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("processes ALL clinics, then throws when any failed", async () => {
    state.rows = [row("a"), row("b"), row("c")];
    reconcile.mockImplementation(async (clinicId: string) => {
      if (clinicId === "a") throw new Error("write failed");
    });
    await expect(processPvsAgentHealthScan()).rejects.toThrow(/1\/3 clinics failed/);
    expect(reconcile).toHaveBeenCalledTimes(3);
  });

  it("re-asserts heartbeat-scope alerts from stored state for connected clinics", async () => {
    state.rows = [row("a", { missingFolders: ["S:\GDT"] })];
    await processPvsAgentHealthScan();
    const [, conditions, scope] = reconcile.mock.calls[0] as [
      string,
      Array<{ key: string }>,
      string[],
    ];
    expect(conditions.map((c) => c.key)).toContain("folder_missing");
    expect(scope).toContain("folder_missing");
    expect(scope).toContain("heartbeat_stale");
  });

  it("only clears liveness alerts for a non-connected clinic", async () => {
    state.rows = [row("a", { linkStatus: "disconnected", missingFolders: ["x"] })];
    await processPvsAgentHealthScan();
    const [, conditions, scope] = reconcile.mock.calls[0] as [
      string,
      unknown[],
      string[],
    ];
    expect(conditions).toEqual([]);
    expect(scope).not.toContain("folder_missing");
  });

  it("emails ops when the dead-letter queue holds jobs", async () => {
    state.rows = [];
    execute.mockResolvedValue([{ n: 4 }]);
    await processPvsAgentHealthScan();
    expect(notifyOps).toHaveBeenCalledTimes(1);
    expect(notifyOps.mock.calls[0]![0]).toMatchObject({
      clinicId: null,
      kind: "pvs_dead_letter",
      severity: "high",
    });
  });

  it("stays quiet on an empty or unreadable dead-letter queue", async () => {
    state.rows = [];
    await processPvsAgentHealthScan();
    execute.mockRejectedValue(new Error("no pgboss schema"));
    await processPvsAgentHealthScan();
    expect(notifyOps).not.toHaveBeenCalled();
  });
});
