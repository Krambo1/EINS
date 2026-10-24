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
const resolveManifest = vi.fn(
  async (_clinicId: string) =>
    [] as Array<{ vendor: string; version: number; sha256: string }>
);

// Records of DB writes the handlers performed.
const upserts: Array<{ table: string; vals: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; vals: Record<string, unknown> }> = [];
const deletes: Array<{ table: string }> = [];

/**
 * 0069: the heartbeat handler reads the stored health slice before upserting,
 * so an older agent that omits the health fields keeps its last known values
 * and the alert reconcile can be skipped while nothing changed. Tests set this
 * to the row the SELECT should return (`null` = clinic not seen before).
 */
let priorAgentStatus: Record<string, unknown> | null = null;
/** Rows the open-alert existence check (dashboard_alerts) should return. */
let openAlerts: Array<{ dedupeKey: string }> = [];

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
/**
 * 0071: the heartbeat response carries the vendor-config manifest. Mocked here
 * so these tests stay about the handler's branching; the resolution itself has
 * its own coverage in server/pvs-vendor-config.test.ts.
 */
vi.mock("@/server/pvs-vendor-config", () => ({
  resolveManifest: (clinicId: string) => resolveManifest(clinicId),
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
    // 0069: prior-health read. Only the heartbeat handler selects, and it
    // always reads pvs_agent_status by clinic PK, so one canned row suffices.
    select: (_proj: unknown) => ({
      from: (table: { __name?: string }) => ({
        where: (_pred: unknown) => {
          // The open-alert existence check awaits the where() directly.
          const rows =
            table.__name === "dashboard_alerts"
              ? openAlerts
              : priorAgentStatus
                ? [priorAgentStatus]
                : [];
          return {
            limit: (_n: number) => Promise.resolve(rows),
            then: (
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => unknown
            ) => Promise.resolve(rows).then(resolve, reject),
          };
        },
      }),
    }),
    // 0069: alert auto-resolve deletes rows whose condition cleared.
    delete: (table: { __name: string }) => ({
      where: (_pred: unknown) => {
        deletes.push({ table: table.__name });
        return Promise.resolve();
      },
    }),
  },
  schema: {
    pvsAgentStatus: {
      __name: "pvs_agent_status",
      clinicId: "clinicId",
      stalePendingEvents: "stalePendingEvents",
      missingFolders: "missingFolders",
      dbAdaptersFailed: "dbAdaptersFailed",
      adapterStatuses: "adapterStatuses",
      lastHeartbeatAt: "lastHeartbeatAt",
      firstHeartbeatAt: "firstHeartbeatAt",
      clockSkewSeconds: "clockSkewSeconds",
      failedEvents: "failedEvents",
      uploadDiagnostics: "uploadDiagnostics",
    },
    pvsAgentFailureSummary: { __name: "pvs_agent_failure_summary", id: "id" },
    pvsLinkSource: {
      __name: "pvs_link_source",
      clinicId: "clinicId",
      bridgeSource: "bridgeSource",
    },
    dashboardAlerts: {
      __name: "dashboard_alerts",
      clinicId: "clinicId",
      kind: "kind",
      dedupeKey: "dedupeKey",
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
  sentAt: Date.now(),
};

/** A stored row whose failed count already matches validHeartbeat (no dead_letter rise). */
const settledPrior = {
  failedEvents: 3,
  stalePendingEvents: 0,
  missingFolders: [],
  dbAdaptersFailed: null,
  adapterStatuses: [],
};

const validFailureSummary = {
  clinicId: CLINIC,
  prunedCount: 42,
  prunedOldestAt: 1_690_000_000_000,
  prunedNewestAt: 1_700_000_000_000,
  reasons: [{ reason: "http 503", count: 40 }],
  sentAt: Date.now(),
};

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ ok: true, resetInSeconds: 60 });
  verifyClinicSignature.mockReset().mockResolvedValue(true);
  writeAudit.mockReset().mockResolvedValue(undefined);
  resolveManifest.mockReset().mockResolvedValue([]);
  upserts.length = 0;
  inserts.length = 0;
  deletes.length = 0;
  priorAgentStatus = null;
  openAlerts = [];
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/pvs/agent/heartbeat", () => {
  it("valid signed payload → 200 and upserts pvs_agent_status", async () => {
    priorAgentStatus = settledPrior;
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, configManifest: [] });
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
    priorAgentStatus = settledPrior;
    // Back-compat: an older agent omits the field, so the common heartbeat
    // stays a single write.
    await heartbeatPOST(req(validHeartbeat));
    expect(upserts).toHaveLength(1);
    expect(upserts.some((u) => u.table === "pvs_link_source")).toBe(false);
  });

  it("enrolledVendors → batched upsert into pvs_link_source (Phase 7)", async () => {
    priorAgentStatus = settledPrior;
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

  it("drops an unknown enrolledVendors value instead of rejecting the heartbeat", async () => {
    // Version skew makes this reachable: an agent that knows a vendor the
    // portal enum does not yet list would otherwise 400 EVERY heartbeat
    // forever, taking the backlog and failure telemetry down with it. The
    // unknown value is dropped (pvs_link_source has its own CHECK anyway),
    // the known ones still enroll, and the telemetry still lands.
    const res = await heartbeatPOST(
      req({
        ...validHeartbeat,
        enrolledVendors: ["totally_made_up", "gdt_agent"],
      })
    );
    expect(res.status).toBe(200);
    const agentRow = upserts.find((u) => u.table === "pvs_agent_status");
    expect(agentRow).toBeDefined();
    const sourceRows = upserts.find((u) => u.table === "pvs_link_source");
    expect(
      (sourceRows?.vals as unknown as Array<{ bridgeSource: string }>).map(
        (r) => r.bridgeSource
      )
    ).toEqual(["gdt_agent"]);
  });
});

/**
 * 0069: operational-health telemetry.
 *
 * The agent has sent these fields for a long time; the envelope did not list
 * them and Zod silently stripped them, so a moved export folder or a runner
 * that never started looked exactly like a quiet week at the Praxis (heartbeat
 * green, failedCount 0, no events). These tests lock down that the fields now
 * survive ingest and that the derived alerts are raised and resolved.
 */
describe("POST /api/pvs/agent/heartbeat health telemetry (0069)", () => {
  const agentStatusUpsert = () =>
    upserts.find((u) => u.table === "pvs_agent_status")!.vals;
  const alertUpserts = () =>
    upserts.filter((u) => u.table === "dashboard_alerts");

  const withHealth = (over: Record<string, unknown> = {}) => ({
    ...validHeartbeat,
    failedCount: 0,
    pendingCount: 0,
    stalePendingCount: 0,
    missingFolders: [],
    dbAdaptersFailed: null,
    adapterStatuses: [],
    ...over,
  });

  it("persists the health fields instead of stripping them", async () => {
    const res = await heartbeatPOST(
      req(
        withHealth({
          pendingCount: 7,
          stalePendingCount: 2,
          oldestPendingAt: 1_700_000_000_000,
          missingFolders: ["S:\\GDT\\export"],
          dbAdaptersFailed: "ORA-01017",
          adapterStatuses: [
            {
              vendor: "tomedo",
              stream: "InvoicePaid",
              status: "schema_drift",
              lastError: "ORA-00904",
              connectError: null,
            },
          ],
        })
      )
    );
    expect(res.status).toBe(200);
    const vals = agentStatusUpsert();
    expect(vals.pendingEvents).toBe(7);
    expect(vals.stalePendingEvents).toBe(2);
    expect(vals.oldestPendingAt).toEqual(new Date(1_700_000_000_000));
    expect(vals.missingFolders).toEqual(["S:\\GDT\\export"]);
    expect(vals.dbAdaptersFailed).toBe("ORA-01017");
    expect(
      (vals.adapterStatuses as Array<{ status: string }>)[0].status
    ).toBe("schema_drift");
  });

  it("an older agent that omits the fields does not reset them to zero", async () => {
    // The dangerous regression: writing a healthy-looking default for a field
    // the agent never reported would recreate the exact blind spot 0069 closes.
    priorAgentStatus = {
      stalePendingEvents: 4,
      missingFolders: ["S:\\GDT"],
      dbAdaptersFailed: "boom",
      adapterStatuses: [],
    };
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(200);
    const vals = agentStatusUpsert();
    expect(vals).not.toHaveProperty("stalePendingEvents");
    expect(vals).not.toHaveProperty("missingFolders");
    expect(vals).not.toHaveProperty("dbAdaptersFailed");
    expect(vals).not.toHaveProperty("pendingEvents");
  });

  it("null dbAdaptersFailed is a real value and does clear the stored one", async () => {
    priorAgentStatus = {
      stalePendingEvents: 0,
      missingFolders: [],
      dbAdaptersFailed: "boom",
      adapterStatuses: [],
    };
    await heartbeatPOST(req(withHealth()));
    const vals = agentStatusUpsert();
    expect(vals).toHaveProperty("dbAdaptersFailed", null);
  });

  it("raises an alert when a watch folder goes missing", async () => {
    priorAgentStatus = {
      stalePendingEvents: 0,
      missingFolders: [],
      dbAdaptersFailed: null,
      adapterStatuses: [],
    };
    await heartbeatPOST(
      req(withHealth({ missingFolders: ["S:\\GDT\\export"] }))
    );
    const alerts = alertUpserts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vals.dedupeKey).toBe("pvs_agent_health:folder_missing");
    expect(alerts[0].vals.severity).toBe("high");
    expect(String(alerts[0].vals.body)).toContain("S:\\GDT\\export");
    // The other three heartbeat-scope conditions are resolved in the same pass.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("dashboard_alerts");
  });

  it("skips the alert reconcile while the health picture is unchanged", async () => {
    // Steady state is one heartbeat per clinic per minute, forever. Rewriting
    // alert rows on every beat would be pure churn.
    priorAgentStatus = {
      stalePendingEvents: 0,
      missingFolders: [],
      dbAdaptersFailed: null,
      adapterStatuses: [],
    };
    await heartbeatPOST(req(withHealth()));
    expect(alertUpserts()).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("reconciles on the very first heartbeat from a clinic", async () => {
    priorAgentStatus = null;
    await heartbeatPOST(req(withHealth({ stalePendingCount: 3 })));
    const alerts = alertUpserts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vals.dedupeKey).toBe("pvs_agent_health:backlog_stuck");
  });

  it("resolves the alert once the condition clears", async () => {
    priorAgentStatus = {
      stalePendingEvents: 0,
      missingFolders: ["S:\\GDT"],
      dbAdaptersFailed: null,
      adapterStatuses: [],
    };
    await heartbeatPOST(req(withHealth({ missingFolders: [] })));
    expect(alertUpserts()).toHaveLength(0);
    // Resolution DELETES rather than stamping dismissed_at, so a condition
    // that comes back later can raise a fresh alert.
    expect(deletes).toHaveLength(1);
  });

  it("degrades a malformed adapterStatuses entry instead of 400ing the heartbeat", async () => {
    // Telemetry never rejects on shape or size. A rejecting bound does not
    // drop one heartbeat: the trigger value is persistent, so it drops every
    // future one and the Praxis goes fully dark exactly when something broke.
    const res = await heartbeatPOST(
      req(withHealth({ adapterStatuses: [{ vendor: "tomedo" }] }))
    );
    expect(res.status).toBe(200);
    const entry = (
      agentStatusUpsert().adapterStatuses as Array<Record<string, unknown>>
    )[0];
    expect(entry.vendor).toBe("tomedo");
    expect(entry.stream).toBe("unbekannt");
  });

  it("survives an oversized error message by truncating it", async () => {
    const huge = "ORA-00600: ".repeat(2_000);
    const res = await heartbeatPOST(req(withHealth({ dbAdaptersFailed: huge })));
    expect(res.status).toBe(200);
    expect(String(agentStatusUpsert().dbAdaptersFailed)).toHaveLength(2_000);
  });

  it("clamps an out-of-range epoch instead of 500ing forever", async () => {
    // new Date(9e18) is an Invalid Date, and the driver throws RangeError the
    // moment it serializes it, which the handler answers with 500. The agent
    // retries a 500 forever, so an agent reporting microsecond timestamps
    // would be permanently dark.
    const res = await heartbeatPOST(
      req(withHealth({ sentAt: 9e18, oldestFailedAt: 9e18 }))
    );
    expect(res.status).toBe(200);
    const vals = agentStatusUpsert();
    expect(() =>
      (vals.lastHeartbeatAt as Date).toISOString()
    ).not.toThrow();
    expect(() => (vals.oldestFailedAt as Date).toISOString()).not.toThrow();
  });

  it("a wrong-typed health field is treated as absent, not as all-clear", async () => {
    // The dangerous shape: degrading garbage to "" / 0 / [] would read as
    // "no failure", overwrite the stored values AND auto-resolve a live
    // alert, silently recreating the blind spot this endpoint exists to close.
    priorAgentStatus = {
      stalePendingEvents: 9,
      missingFolders: ["S:\\GDT"],
      dbAdaptersFailed: "ORA-01017",
      adapterStatuses: [],
    };
    // The alerts for the stored state exist, so only a real change would write.
    openAlerts = [
      { dedupeKey: "pvs_agent_health:folder_missing" },
      { dedupeKey: "pvs_agent_health:adapters_down" },
      { dedupeKey: "pvs_agent_health:backlog_stuck" },
    ];
    const res = await heartbeatPOST(
      req({
        ...validHeartbeat,
        stalePendingCount: "boom",
        missingFolders: 5,
        dbAdaptersFailed: {},
        adapterStatuses: "x",
      })
    );
    expect(res.status).toBe(200);
    const vals = agentStatusUpsert();
    expect(vals).not.toHaveProperty("stalePendingEvents");
    expect(vals).not.toHaveProperty("missingFolders");
    expect(vals).not.toHaveProperty("dbAdaptersFailed");
    expect(vals).not.toHaveProperty("adapterStatuses");
    // Nothing changed, so no alert may be raised and none resolved.
    expect(alertUpserts()).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("survives a backlog past the old counter bound", async () => {
    // An outbox past a million rows is the incident we want reported, not a
    // reason to refuse the report.
    const res = await heartbeatPOST(
      req(withHealth({ failedCount: 5_000_000, stalePendingCount: 5_000_000 }))
    );
    expect(res.status).toBe(200);
    expect(agentStatusUpsert().failedEvents).toBe(1_000_000);
    expect(agentStatusUpsert().stalePendingEvents).toBe(1_000_000);
  });
});

/**
 * 0071: the heartbeat is both halves of remote config delivery. It carries what
 * the machine RUNS (so the portal can tell a delivered push from a published
 * one) and answers with what it SHOULD run.
 */
describe("POST /api/pvs/agent/heartbeat — vendor configs", () => {
  const agentStatusUpsert = () =>
    upserts.find((u) => u.table === "pvs_agent_status")!.vals;
  const withConfigs = (extra: Record<string, unknown>) => ({
    ...validHeartbeat,
    ...extra,
  });

  it("returns the clinic's config manifest so the agent can act on it", async () => {
    resolveManifest.mockResolvedValue([
      { vendor: "tomedo-db", version: 4, sha256: "a".repeat(64) },
    ]);
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      configManifest: [
        { vendor: "tomedo-db", version: 4, sha256: "a".repeat(64) },
      ],
    });
  });

  it("still accepts the heartbeat when manifest resolution fails", async () => {
    priorAgentStatus = settledPrior;
    // The telemetry is already committed at that point, and an agent that
    // retries a 500 forever would lose it.
    resolveManifest.mockRejectedValue(new Error("db down"));
    const res = await heartbeatPOST(req(validHeartbeat));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, configManifest: [] });
    expect(upserts).toHaveLength(1);
  });

  it("stores what the agent reports it is running", async () => {
    const res = await heartbeatPOST(
      req(
        withConfigs({
          vendorConfigs: [
            {
              vendor: "tomedo-db",
              version: 4,
              sha256: "b".repeat(64),
              appliedAt: 1_700_000_000_000,
              source: "remote",
            },
          ],
          configSyncError: null,
        })
      )
    );
    expect(res.status).toBe(200);
    expect(agentStatusUpsert().vendorConfigs).toEqual([
      {
        vendor: "tomedo-db",
        version: 4,
        sha256: "b".repeat(64),
        appliedAt: 1_700_000_000_000,
        source: "remote",
      },
    ]);
    expect(agentStatusUpsert().configSyncError).toBeNull();
  });

  it("stores a rollback the machine performed on its own", async () => {
    await heartbeatPOST(
      req(
        withConfigs({
          configRollbacks: [
            {
              vendor: "tomedo-db",
              rejectedVersion: 5,
              revertedTo: 4,
              reason: "Streams halted after the update: InvoicePaid=error",
              at: 1_700_000_500_000,
            },
          ],
        })
      )
    );
    expect(agentStatusUpsert().configRollbacks).toMatchObject([
      { vendor: "tomedo-db", rejectedVersion: 5, revertedTo: 4 },
    ]);
  });

  it("leaves the stored config state alone when an older agent omits the fields", async () => {
    // Same invariant as the 0069 health fields: absent means "this build cannot
    // report it", never "all clear".
    await heartbeatPOST(req(validHeartbeat));
    const vals = agentStatusUpsert();
    expect(vals).not.toHaveProperty("vendorConfigs");
    expect(vals).not.toHaveProperty("configSyncError");
    expect(vals).not.toHaveProperty("configRollbacks");
  });

  it("truncates an oversized sync error rather than rejecting the heartbeat", async () => {
    await heartbeatPOST(
      req(withConfigs({ configSyncError: "x".repeat(5_000) }))
    );
    expect((agentStatusUpsert().configSyncError as string).length).toBe(1_000);
  });

  it("keeps the heartbeat when the config fields are garbage", async () => {
    const res = await heartbeatPOST(
      req(
        withConfigs({
          vendorConfigs: "not-an-array",
          configRollbacks: 42,
        })
      )
    );
    expect(res.status).toBe(200);
    const vals = agentStatusUpsert();
    expect(vals).not.toHaveProperty("vendorConfigs");
    expect(vals).not.toHaveProperty("configRollbacks");
    expect(vals.failedEvents).toBe(3);
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

describe("POST /api/pvs/agent/heartbeat — ops hardening (0079)", () => {
  const agentUpsert = () =>
    upserts.find((u) => u.table === "pvs_agent_status")!.vals;
  const alertUpserts = () =>
    upserts.filter((u) => u.table === "dashboard_alerts");
  const healthyPrior = {
    stalePendingEvents: 0,
    missingFolders: [],
    dbAdaptersFailed: null,
    adapterStatuses: [],
  };

  it("stores the SERVER receive time as lastHeartbeatAt, never the agent's sentAt", async () => {
    const before = Date.now();
    // Agent clock 30 days ahead: the old code would hide a dead agent for 30 days.
    const sentAt = before + 30 * 24 * 3600 * 1000;
    await heartbeatPOST(req({ ...validHeartbeat, sentAt }));
    const beat = agentUpsert().lastHeartbeatAt as Date;
    expect(beat.getTime()).toBeGreaterThanOrEqual(before);
    expect(beat.getTime()).toBeLessThanOrEqual(Date.now());
    expect(agentUpsert().clockSkewSeconds).toBeGreaterThan(29 * 24 * 3600);
  });

  it("raises a low-severity agent_clock_skew alert beyond 5 minutes", async () => {
    priorAgentStatus = { ...healthyPrior, clockSkewSeconds: 0 };
    await heartbeatPOST(
      req({ ...validHeartbeat, sentAt: Date.now() + 10 * 60 * 1000 })
    );
    const alerts = alertUpserts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vals.dedupeKey).toBe("pvs_agent_health:agent_clock_skew");
    expect(alerts[0].vals.severity).toBe("warn");
  });

  it("stays quiet for a skew inside 5 minutes", async () => {
    priorAgentStatus = { ...healthyPrior, clockSkewSeconds: 0 };
    await heartbeatPOST(
      req({ ...validHeartbeat, sentAt: Date.now() + 60 * 1000 })
    );
    expect(alertUpserts()).toHaveLength(0);
  });

  it("re-asserts a missing alert even though the signature did not change", async () => {
    // The previous reconcile write failed: the stored state already shows the
    // halted stream, but no alert row exists.
    const stalled = { ...healthyPrior, stalePendingEvents: 3 };
    priorAgentStatus = { ...stalled, clockSkewSeconds: 0 };
    openAlerts = [];
    await heartbeatPOST(req({ ...validHeartbeat, stalePendingCount: 3 }));
    const alerts = alertUpserts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vals.dedupeKey).toBe("pvs_agent_health:backlog_stuck");
  });

  it("does not rewrite the alert when the row exists and nothing changed", async () => {
    priorAgentStatus = {
      ...healthyPrior,
      stalePendingEvents: 3,
      clockSkewSeconds: 0,
    };
    openAlerts = [{ dedupeKey: "pvs_agent_health:backlog_stuck" }];
    await heartbeatPOST(req({ ...validHeartbeat, stalePendingCount: 3 }));
    expect(alertUpserts()).toHaveLength(0);
  });

  it("first heartbeat of a seeded row clears heartbeat_never", async () => {
    priorAgentStatus = {
      ...healthyPrior,
      clockSkewSeconds: null,
      firstHeartbeatAt: null,
      lastHeartbeatAt: new Date(Date.now() - 3 * 3600 * 1000),
    };
    await heartbeatPOST(req(validHeartbeat));
    expect(deletes).toHaveLength(1);
  });

  it("does not spend the per-clinic rate limit on an unsigned request", async () => {
    verifyClinicSignature.mockResolvedValue(false);
    await heartbeatPOST(req(validHeartbeat));
    const namespaces = rateLimit.mock.calls.map((c) => c[0]);
    expect(namespaces).toContain("pvs-agent-hb-ip");
    expect(namespaces).not.toContain("pvs-agent-hb");
  });

  it("spends the per-clinic rate limit after a valid signature", async () => {
    await heartbeatPOST(req(validHeartbeat));
    expect(rateLimit.mock.calls.map((c) => c[0])).toContain("pvs-agent-hb");
  });
});

describe("POST /api/pvs/agent/heartbeat - dead letters and upload diagnostics (WP-C B5)", () => {
  const agentStatusUpsert = () =>
    upserts.find((u) => u.table === "pvs_agent_status")!.vals;
  const alertUpserts = () =>
    upserts.filter((u) => u.table === "dashboard_alerts");
  const quietPrior = (over: Record<string, unknown> = {}) => ({
    stalePendingEvents: 0,
    missingFolders: [],
    dbAdaptersFailed: null,
    adapterStatuses: [],
    failedEvents: 0,
    uploadDiagnostics: null,
    ...over,
  });
  const beat = (over: Record<string, unknown> = {}) => ({
    ...validHeartbeat,
    failedCount: 0,
    recentReasons: [],
    pendingCount: 0,
    stalePendingCount: 0,
    missingFolders: [],
    dbAdaptersFailed: null,
    adapterStatuses: [],
    ...over,
  });

  it("raises a high dead_letter alert naming the reasons when failedCount rises 0 -> 5", async () => {
    priorAgentStatus = quietPrior();
    await heartbeatPOST(
      req(
        beat({
          failedCount: 5,
          recentReasons: [{ reason: "invalid_envelope", count: 5 }],
        })
      )
    );
    const alerts = alertUpserts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vals.dedupeKey).toBe("pvs_agent_health:dead_letter");
    expect(alerts[0].vals.severity).toBe("high");
    expect(String(alerts[0].vals.body)).toContain("invalid_envelope");
    expect(JSON.stringify(alerts[0].vals.actionSteps)).toContain("--requeue-failed");
  });

  it("does not re-raise while the failed count stays the same, and keeps the alert", async () => {
    priorAgentStatus = quietPrior({ failedEvents: 5 });
    await heartbeatPOST(req(beat({ failedCount: 5 })));
    expect(alertUpserts()).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("resolves the dead_letter alert once failedCount is back to 0", async () => {
    priorAgentStatus = quietPrior({ failedEvents: 5 });
    await heartbeatPOST(req(beat({ failedCount: 0 })));
    expect(alertUpserts()).toHaveLength(0);
    expect(deletes).toHaveLength(1);
  });

  it("stores uploadState, pendingReasons and fileWatchers in upload_diagnostics", async () => {
    priorAgentStatus = quietPrior();
    await heartbeatPOST(
      req(
        beat({
          uploadState: {
            authPaused: false,
            lastBatchError: "link_not_ready",
            lastBatchErrorAt: 1_700_000_000_000,
            consecutiveTransientFailures: 4,
            lastSuccessAt: null,
          },
          pendingReasons: [{ reason: "link_not_ready", count: 12 }],
          fileWatchers: { gdt: { quarantinedFiles: 3 }, csv: null },
        })
      )
    );
    const d = agentStatusUpsert().uploadDiagnostics as Record<string, any>;
    expect(d.uploadState.lastBatchError).toBe("link_not_ready");
    expect(d.pendingReasons).toEqual([{ reason: "link_not_ready", count: 12 }]);
    expect(d.fileWatchers.gdt.quarantinedFiles).toBe(3);
  });

  it("tolerates garbage diagnostics and leaves the stored ones alone", async () => {
    priorAgentStatus = quietPrior({
      uploadDiagnostics: { pendingReasons: [{ reason: "x", count: 1 }] },
    });
    const res = await heartbeatPOST(
      req(
        beat({
          uploadState: "nope",
          pendingReasons: 7,
          fileWatchers: [1, 2],
        })
      )
    );
    expect(res.status).toBe(200);
    expect(agentStatusUpsert()).not.toHaveProperty("uploadDiagnostics");
  });

  it("an older agent without the fields does not touch upload_diagnostics", async () => {
    priorAgentStatus = quietPrior();
    await heartbeatPOST(req(beat()));
    expect(agentStatusUpsert()).not.toHaveProperty("uploadDiagnostics");
  });

  it("backlog_stuck names the upload reason instead of blaming the firewall", async () => {
    priorAgentStatus = quietPrior();
    await heartbeatPOST(
      req(
        beat({
          stalePendingCount: 30,
          uploadState: {
            authPaused: false,
            lastBatchError: null,
            lastBatchErrorAt: null,
            consecutiveTransientFailures: 6,
            lastSuccessAt: null,
          },
          pendingReasons: [{ reason: "link_not_ready", count: 30 }],
        })
      )
    );
    const a = alertUpserts().find(
      (u) => u.vals.dedupeKey === "pvs_agent_health:backlog_stuck"
    )!;
    expect(String(a.vals.body)).toContain("link_not_ready");
    expect(JSON.stringify(a.vals.actionSteps)).not.toMatch(/Firewall/);
  });
});
