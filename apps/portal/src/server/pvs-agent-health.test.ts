import { describe, expect, it } from "vitest";
import {
  businessMsBetween,
  evaluateAgentLiveness,
  evaluateHeartbeatHealth,
  healthSignature,
  HEARTBEAT_SCOPE_KEYS,
  HEARTBEAT_STALE_MS,
  LIVENESS_SCOPE_KEYS,
  SILENT_STALL_BUSINESS_MS,
  type AgentHeartbeatHealth,
} from "./pvs-agent-health";

/**
 * PVS agent-health evaluation (migration 0069).
 *
 * The alert WRITES need a live database and are exercised end to end in the
 * soak harness. What is locked down here is the decision layer, because the
 * whole point of 0069 is that these conditions are the only thing separating
 * "the Praxis had a quiet week" from "the install has been dead since
 * Tuesday". A regression that silently stops raising one of them restores
 * exactly the blind spot the migration was written to close.
 */

const healthy = (over: Partial<AgentHeartbeatHealth> = {}): AgentHeartbeatHealth => ({
  stalePendingEvents: 0,
  missingFolders: [],
  dbAdaptersFailed: null,
  adapterStatuses: [],
  ...over,
});

const stream = (over: Record<string, unknown> = {}) => ({
  vendor: "tomedo",
  stream: "InvoicePaid",
  status: "running",
  lastError: null,
  connectError: null,
  ...over,
});

describe("evaluateHeartbeatHealth", () => {
  it("raises nothing for a healthy agent", () => {
    expect(evaluateHeartbeatHealth(healthy())).toEqual([]);
  });

  it("raises folder_missing when a watch folder cannot be found", () => {
    const [c, ...rest] = evaluateHeartbeatHealth(
      healthy({ missingFolders: ["S:\\GDT\\export"] })
    );
    expect(rest).toEqual([]);
    expect(c.key).toBe("folder_missing");
    expect(c.severity).toBe("high");
    expect(c.observedValue).toBe(1);
    expect(c.body).toContain("S:\\GDT\\export");
  });

  it("raises adapters_down and surfaces the underlying error", () => {
    const [c] = evaluateHeartbeatHealth(
      healthy({ dbAdaptersFailed: "ORA-01017: invalid credential" })
    );
    expect(c.key).toBe("adapters_down");
    expect(c.body).toContain("ORA-01017");
  });

  it("treats a halted stream as unhealthy even while other streams run", () => {
    const [c] = evaluateHeartbeatHealth(
      healthy({
        adapterStatuses: [
          stream({ stream: "AppointmentCreated", status: "running" }),
          stream({ status: "schema_drift", lastError: "ORA-00904 BETRAG" }),
        ],
      })
    );
    expect(c.key).toBe("stream_halted");
    expect(c.observedValue).toBe(1);
    expect(c.body).toContain("tomedo/InvoicePaid");
    expect(c.body).toContain("ORA-00904 BETRAG");
  });

  it("treats a connectError as halted even when the status still reads running", () => {
    // A rotated DB password never touches db_adapter_state, so the stream
    // keeps reporting its last good status. connectError is the only signal.
    const [c] = evaluateHeartbeatHealth(
      healthy({
        adapterStatuses: [
          stream({ status: "running", connectError: "ECONNREFUSED" }),
        ],
      })
    );
    expect(c.key).toBe("stream_halted");
    expect(c.body).toContain("ECONNREFUSED");
  });

  it("does not flag idle or disabled streams", () => {
    expect(
      evaluateHeartbeatHealth(
        healthy({
          adapterStatuses: [
            stream({ status: "idle" }),
            stream({ stream: "RecallScheduled", status: "disabled" }),
          ],
        })
      )
    ).toEqual([]);
  });

  it("raises backlog_stuck only once the backlog has gone stale", () => {
    // pendingEvents alone is normal in-flight traffic. stalePendingEvents is
    // the one that means the outbox is retrying into a wall.
    expect(evaluateHeartbeatHealth(healthy({ stalePendingEvents: 0 }))).toEqual(
      []
    );
    const [c] = evaluateHeartbeatHealth(healthy({ stalePendingEvents: 12 }));
    expect(c.key).toBe("backlog_stuck");
    expect(c.observedValue).toBe(12);
  });

  it("raises every independent condition at once", () => {
    const keys = evaluateHeartbeatHealth(
      healthy({
        stalePendingEvents: 3,
        missingFolders: ["S:\\GDT"],
        dbAdaptersFailed: "boom",
        adapterStatuses: [stream({ status: "error" })],
      })
    ).map((c) => c.key);
    expect(new Set(keys)).toEqual(new Set(HEARTBEAT_SCOPE_KEYS));
  });

  it("only emits keys the heartbeat scope owns", () => {
    // The ingest path and the hourly scan reconcile against disjoint scopes.
    // If this evaluator ever emitted a liveness key it would delete the
    // worker's alert on the very next heartbeat.
    const keys = evaluateHeartbeatHealth(
      healthy({
        stalePendingEvents: 1,
        missingFolders: ["x"],
        dbAdaptersFailed: "y",
        adapterStatuses: [stream({ status: "config_invalid" })],
      })
    ).map((c) => c.key);
    for (const k of keys) {
      expect(HEARTBEAT_SCOPE_KEYS).toContain(k);
      expect(LIVENESS_SCOPE_KEYS).not.toContain(k);
    }
  });
});

describe("businessMsBetween", () => {
  const H = 60 * 60 * 1000;

  it("counts a plain weekday span in full", () => {
    // Tue 09:00 to Wed 09:00.
    expect(
      businessMsBetween(
        new Date("2026-07-21T09:00:00Z"),
        new Date("2026-07-22T09:00:00Z")
      )
    ).toBe(24 * H);
  });

  it("excludes Saturday and Sunday", () => {
    // Fri 2026-07-24 12:00 to Mon 2026-07-27 13:00 is 73h wall clock, of
    // which 48h is the weekend.
    expect(
      businessMsBetween(
        new Date("2026-07-24T12:00:00Z"),
        new Date("2026-07-27T13:00:00Z")
      )
    ).toBe(25 * H);
  });

  it("returns 0 for a non-positive span", () => {
    const d = new Date("2026-07-21T09:00:00Z");
    expect(businessMsBetween(d, d)).toBe(0);
    expect(businessMsBetween(new Date("2026-07-22T09:00:00Z"), d)).toBe(0);
  });

  it("stays bounded for an absurdly old timestamp", () => {
    // Must not walk 20 years of days one at a time.
    const out = businessMsBetween(
      new Date("2006-01-01T00:00:00Z"),
      new Date("2026-07-21T00:00:00Z")
    );
    expect(out).toBeGreaterThan(0);
    expect(Number.isFinite(out)).toBe(true);
  });
});

describe("evaluateAgentLiveness", () => {
  // A Tuesday, so plain "N hours ago" arithmetic stays inside the work week.
  const now = new Date("2026-07-21T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const H = 60 * 60 * 1000;

  it("stays quiet for a fresh heartbeat and recent events", () => {
    expect(
      evaluateAgentLiveness({
        lastHeartbeatAt: ago(30_000),
        lastEventAt: ago(H),
        agentFirstSeenAt: ago(90 * 24 * H),
        now,
      })
    ).toEqual([]);
  });

  it("raises heartbeat_stale past the threshold", () => {
    expect(
      evaluateAgentLiveness({
        lastHeartbeatAt: ago(HEARTBEAT_STALE_MS - 1_000),
        lastEventAt: ago(1_000),
        agentFirstSeenAt: ago(90 * 24 * H),
        now,
      })
    ).toEqual([]);
    const [c] = evaluateAgentLiveness({
      lastHeartbeatAt: ago(HEARTBEAT_STALE_MS + 60_000),
      lastEventAt: ago(1_000),
      agentFirstSeenAt: ago(90 * 24 * H),
      now,
    });
    expect(c.key).toBe("heartbeat_stale");
    expect(c.severity).toBe("high");
  });

  it("reports a silent agent once, not as two incidents", () => {
    // A dead agent explains the missing events by itself. Raising the stall
    // alert on top would page the operator twice for one problem.
    const keys = evaluateAgentLiveness({
      lastHeartbeatAt: ago(6 * H),
      lastEventAt: ago(30 * 24 * H),
      agentFirstSeenAt: ago(90 * 24 * H),
      now,
    }).map((c) => c.key);
    expect(keys).toEqual(["heartbeat_stale"]);
  });

  it("raises silent_stall when the agent is healthy but delivers nothing", () => {
    // Tue 12:00 back to the previous Thu 12:00 is 5 wall days but only 3
    // business days, which is past the 2-business-day threshold.
    const [c] = evaluateAgentLiveness({
      lastHeartbeatAt: ago(30_000),
      lastEventAt: new Date("2026-07-16T12:00:00Z"),
      agentFirstSeenAt: new Date("2026-01-01T00:00:00Z"),
      now,
    });
    expect(c.key).toBe("silent_stall");
    expect(c.observedValue).toBe(3);
    expect(c.title).toContain("liefert aber keine Daten");
  });

  it("does not fire over a weekend, including a Friday-midday close", () => {
    // THE false-positive that a wall-clock threshold produces: a Praxis that
    // closes Friday midday is silent ~73h by Monday afternoon and is working
    // perfectly normally. A high-severity alert here gets trained away.
    expect(
      evaluateAgentLiveness({
        lastHeartbeatAt: new Date("2026-07-27T13:04:30Z"),
        lastEventAt: new Date("2026-07-24T12:00:00Z"), // Friday midday
        agentFirstSeenAt: new Date("2026-01-01T00:00:00Z"),
        now: new Date("2026-07-27T13:05:00Z"), // Monday afternoon
      })
    ).toEqual([]);
  });

  it("raises silent_stall for an install that has NEVER delivered an event", () => {
    // lastEventAt stays null forever in this case. Keying the stall check off
    // it alone would exempt the single worst outcome: an install that never
    // worked at all, which is exactly what a first client hits.
    const [c] = evaluateAgentLiveness({
      lastHeartbeatAt: ago(30_000),
      lastEventAt: null,
      agentFirstSeenAt: new Date("2026-07-13T09:00:00Z"),
      now,
    });
    expect(c.key).toBe("silent_stall");
    expect(c.title).toContain("noch nie");
    expect(c.body).toContain("seit der Einrichtung");
  });

  it("gives a fresh install a grace period before the never-delivered alert", () => {
    // Enrolled yesterday and nothing billed yet is not an incident.
    expect(
      evaluateAgentLiveness({
        lastHeartbeatAt: ago(30_000),
        lastEventAt: null,
        agentFirstSeenAt: ago(24 * H),
        now,
      })
    ).toEqual([]);
  });

  it("only emits keys the liveness scope owns", () => {
    const keys = [
      ...evaluateAgentLiveness({
        lastHeartbeatAt: ago(HEARTBEAT_STALE_MS + 1),
        lastEventAt: null,
        agentFirstSeenAt: ago(90 * 24 * H),
        now,
      }),
      ...evaluateAgentLiveness({
        lastHeartbeatAt: ago(0),
        lastEventAt: null,
        agentFirstSeenAt: ago(90 * 24 * H),
        now,
      }),
    ].map((c) => c.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(LIVENESS_SCOPE_KEYS).toContain(k);
      expect(HEARTBEAT_SCOPE_KEYS).not.toContain(k);
    }
  });

  it("uses business time, not wall time, for the threshold", () => {
    // Sanity-check the constant is actually consumed as business ms.
    expect(SILENT_STALL_BUSINESS_MS).toBe(48 * H);
  });
});

describe("healthSignature", () => {
  it("is stable for an unchanged health picture", () => {
    expect(healthSignature(healthy())).toBe(healthSignature(healthy()));
  });

  it("ignores backlog size changes within the same order of magnitude", () => {
    // The ingest route reconciles alerts only when the signature changes. A
    // backlog ticking 3 to 4 to 5 is one incident and must not rewrite the
    // alert row on every heartbeat.
    expect(healthSignature(healthy({ stalePendingEvents: 3 }))).toBe(
      healthSignature(healthy({ stalePendingEvents: 5 }))
    );
  });

  it("does refresh when the backlog grows by an order of magnitude", () => {
    // The count is rendered IN the alert text, so a backlog that goes from 3
    // to 5 000 must not keep telling the operator "3".
    expect(healthSignature(healthy({ stalePendingEvents: 3 }))).not.toBe(
      healthSignature(healthy({ stalePendingEvents: 5_000 }))
    );
  });

  it("refreshes when a halted stream's reason changes", () => {
    // The alert body renders connectError ?? lastError ?? status, so a stream
    // stuck in 'error' with a new reason has to update the text.
    expect(
      healthSignature(
        healthy({ adapterStatuses: [stream({ status: "error", lastError: "a" })] })
      )
    ).not.toBe(
      healthSignature(
        healthy({ adapterStatuses: [stream({ status: "error", lastError: "b" })] })
      )
    );
  });

  it("changes when the backlog first goes stale and when it clears", () => {
    const ok = healthSignature(healthy());
    const stuck = healthSignature(healthy({ stalePendingEvents: 1 }));
    expect(stuck).not.toBe(ok);
    expect(healthSignature(healthy({ stalePendingEvents: 0 }))).toBe(ok);
  });

  it("is order-insensitive for folders and streams", () => {
    expect(healthSignature(healthy({ missingFolders: ["a", "b"] }))).toBe(
      healthSignature(healthy({ missingFolders: ["b", "a"] }))
    );
    expect(
      healthSignature(
        healthy({
          adapterStatuses: [
            stream({ stream: "A" }),
            stream({ stream: "B" }),
          ],
        })
      )
    ).toBe(
      healthSignature(
        healthy({
          adapterStatuses: [
            stream({ stream: "B" }),
            stream({ stream: "A" }),
          ],
        })
      )
    );
  });

  it("changes when a stream halts and when a connect error appears", () => {
    const ok = healthSignature(healthy({ adapterStatuses: [stream()] }));
    expect(
      healthSignature(healthy({ adapterStatuses: [stream({ status: "error" })] }))
    ).not.toBe(ok);
    expect(
      healthSignature(
        healthy({ adapterStatuses: [stream({ connectError: "ECONNREFUSED" })] })
      )
    ).not.toBe(ok);
  });

  it("distinguishes a different missing folder from a different count", () => {
    expect(healthSignature(healthy({ missingFolders: ["a"] }))).not.toBe(
      healthSignature(healthy({ missingFolders: ["b"] }))
    );
  });
});
