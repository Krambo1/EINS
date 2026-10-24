import { describe, expect, it } from "vitest";
import {
  businessMsBetween,
  evaluateAgentLiveness,
  evaluateHeartbeatHealth,
  germanClosedDays,
  healthSignature,
  isBerlinBusinessHours,
  HEARTBEAT_SCOPE_KEYS,
  LIVENESS_SCOPE_KEYS,
} from "./pvs-agent-health";

const H = 3_600_000;
const iso = (s: string) => new Date(s);
const key = (y: number, m: number, d: number) => y * 10_000 + m * 100 + d;

describe("germanClosedDays", () => {
  it("computes the Easter-based holidays for 2026 (Easter = 5 April)", () => {
    const days = germanClosedDays(2026);
    expect(days.has(key(2026, 4, 3))).toBe(true); // Karfreitag
    expect(days.has(key(2026, 4, 6))).toBe(true); // Ostermontag
    expect(days.has(key(2026, 5, 14))).toBe(true); // Himmelfahrt
    expect(days.has(key(2026, 5, 15))).toBe(true); // Brueckentag
    expect(days.has(key(2026, 5, 25))).toBe(true); // Pfingstmontag
  });

  it("computes 2025 (Easter = 20 April) and the fixed dates", () => {
    const days = germanClosedDays(2025);
    expect(days.has(key(2025, 4, 18))).toBe(true);
    expect(days.has(key(2025, 4, 21))).toBe(true);
    for (const [m, d] of [[1, 1], [5, 1], [10, 3], [12, 25], [12, 26]]) {
      expect(days.has(key(2025, m!, d!))).toBe(true);
    }
    expect(days.has(key(2025, 4, 22))).toBe(false);
  });
});

describe("businessMsBetween (Europe/Berlin)", () => {
  it("excludes the Berlin weekend", () => {
    // Fri 12:00Z to Mon 12:00Z = 72 h, minus Sat + Sun.
    const ms = businessMsBetween(
      iso("2026-07-17T12:00:00Z"),
      iso("2026-07-20T12:00:00Z")
    );
    expect(ms).toBe(24 * H);
  });

  it("excludes Karfreitag and Ostermontag", () => {
    // Thu 2 Apr 12:00Z to Tue 7 Apr 12:00Z: Fri(holiday) Sat Sun Mon(holiday) closed.
    const ms = businessMsBetween(
      iso("2026-04-02T12:00:00Z"),
      iso("2026-04-07T12:00:00Z")
    );
    expect(ms).toBe(24 * H);
  });

  it("a Friday-midday close does not reach the 48 h threshold by Monday evening", () => {
    const ms = businessMsBetween(
      iso("2026-07-17T10:00:00Z"),
      iso("2026-07-20T16:00:00Z")
    );
    expect(ms).toBeLessThan(48 * H);
  });

  it("handles the DST switch day without drifting", () => {
    // 2026-03-29 is the spring-forward Sunday (a closed day): the whole span
    // Sat 00:00 to Mon 00:00 Berlin is closed, so nothing is counted.
    const ms = businessMsBetween(
      iso("2026-03-27T23:00:00Z"),
      iso("2026-03-29T22:00:00Z")
    );
    expect(ms).toBe(0);
  });

  it("never goes negative and is bounded for huge gaps", () => {
    expect(
      businessMsBetween(iso("2026-07-20T12:00:00Z"), iso("2026-07-19T12:00:00Z"))
    ).toBe(0);
    const long = businessMsBetween(
      iso("2020-01-01T00:00:00Z"),
      iso("2026-01-01T00:00:00Z")
    );
    expect(long).toBeGreaterThan(0);
  });
});

describe("isBerlinBusinessHours", () => {
  it("is true 07:00-19:00 Berlin on a working weekday", () => {
    expect(isBerlinBusinessHours(iso("2026-07-21T05:30:00Z"))).toBe(true); // 07:30
    expect(isBerlinBusinessHours(iso("2026-07-21T04:30:00Z"))).toBe(false); // 06:30
    expect(isBerlinBusinessHours(iso("2026-07-21T16:59:00Z"))).toBe(true); // 18:59
    expect(isBerlinBusinessHours(iso("2026-07-21T17:30:00Z"))).toBe(false); // 19:30
  });
  it("is false on weekends and holidays", () => {
    expect(isBerlinBusinessHours(iso("2026-07-25T10:00:00Z"))).toBe(false);
    expect(isBerlinBusinessHours(iso("2026-04-03T10:00:00Z"))).toBe(false);
  });
});

describe("heartbeat_stale severity", () => {
  const base = {
    lastEventAt: null,
    agentFirstSeenAt: iso("2026-01-01T00:00:00Z"),
  };
  it("is high within working hours after 5 minutes", () => {
    const now = iso("2026-07-21T10:00:00Z");
    const out = evaluateAgentLiveness({
      ...base,
      lastHeartbeatAt: new Date(now.getTime() - 10 * 60_000),
      now,
    });
    expect(out.map((c) => [c.key, c.severity])).toEqual([
      ["heartbeat_stale", "high"],
    ]);
  });
  it("stays quiet outside working hours until 14 h, then warns (low)", () => {
    const now = iso("2026-07-21T20:00:00Z"); // 22:00 Berlin
    const quiet = evaluateAgentLiveness({
      ...base,
      lastHeartbeatAt: new Date(now.getTime() - 3 * H),
      now,
    }).map((c) => c.key);
    expect(quiet).not.toContain("heartbeat_stale");
    const late = evaluateAgentLiveness({
      ...base,
      lastHeartbeatAt: new Date(now.getTime() - 15 * H),
      now,
    });
    expect(late[0]).toMatchObject({ key: "heartbeat_stale", severity: "warn" });
  });
});

describe("heartbeat_never", () => {
  const now = iso("2026-07-21T10:00:00Z");
  const input = (hoursSinceEnroll: number) => ({
    lastHeartbeatAt: new Date(now.getTime() - hoursSinceEnroll * H),
    lastEventAt: null,
    agentFirstSeenAt: new Date(now.getTime() - hoursSinceEnroll * H),
    firstHeartbeatAt: null,
    now,
  });
  it("waits 2 h after enrollment", () => {
    expect(evaluateAgentLiveness(input(1))).toEqual([]);
  });
  it("raises a high condition after 2 h and nothing else", () => {
    const out = evaluateAgentLiveness(input(3));
    expect(out.map((c) => [c.key, c.severity])).toEqual([
      ["heartbeat_never", "high"],
    ]);
  });
  it("is owned by the liveness scope", () => {
    expect(LIVENESS_SCOPE_KEYS).toContain("heartbeat_never");
  });
});

describe("agent_clock_skew", () => {
  const healthy = {
    stalePendingEvents: 0,
    missingFolders: [],
    dbAdaptersFailed: null,
    adapterStatuses: [],
  };
  it("raises a warn condition beyond +-5 minutes, in both directions", () => {
    for (const skew of [301, -301, 3 * 24 * 3600]) {
      const out = evaluateHeartbeatHealth({ ...healthy, clockSkewSeconds: skew });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ key: "agent_clock_skew", severity: "warn" });
    }
  });
  it("ignores skew inside the threshold and unknown skew", () => {
    expect(evaluateHeartbeatHealth({ ...healthy, clockSkewSeconds: 299 })).toEqual([]);
    expect(evaluateHeartbeatHealth({ ...healthy, clockSkewSeconds: null })).toEqual([]);
    expect(evaluateHeartbeatHealth(healthy)).toEqual([]);
  });
  it("is owned by the heartbeat scope and part of the signature", () => {
    expect(HEARTBEAT_SCOPE_KEYS).toContain("agent_clock_skew");
    expect(healthSignature({ ...healthy, clockSkewSeconds: 0 })).not.toBe(
      healthSignature({ ...healthy, clockSkewSeconds: 3600 })
    );
    // unknown == within range: no spurious reconcile on the first beat after deploy
    expect(healthSignature({ ...healthy, clockSkewSeconds: null })).toBe(
      healthSignature({ ...healthy, clockSkewSeconds: 0 })
    );
  });
});
