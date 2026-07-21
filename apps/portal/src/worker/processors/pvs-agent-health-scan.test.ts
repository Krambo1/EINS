import { describe, expect, it } from "vitest";
import {
  planAgentLivenessScan,
  type AgentLivenessRow,
} from "./pvs-agent-health-scan";
import { HEARTBEAT_STALE_MS } from "@/server/pvs-agent-health";

/**
 * Decision-layer tests for the hourly agent liveness scan.
 *
 * The database read and the alert writes need a live Postgres and are covered
 * in the soak environment. What is locked down here is the part that decides
 * WHICH clinics get evaluated and which only get their old alerts cleared,
 * because that is where a regression is silent: filtering a clinic out
 * completely would leave a stale "Agent meldet sich nicht" alert on a Praxis
 * that has long since been disconnected.
 */

// A Tuesday, so weekday arithmetic below stays inside the work week.
const NOW = new Date("2026-07-21T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
/** Previous Thursday: 3 business days back, past the stall threshold. */
const STALLED_EVENT_AT = new Date("2026-07-16T12:00:00.000Z");

const row = (over: Partial<AgentLivenessRow> = {}): AgentLivenessRow => ({
  clinicId: "clinic-1",
  linkStatus: "connected",
  lastHeartbeatAt: ago(60_000),
  lastEventAt: ago(60 * 60 * 1000),
  // Long-enrolled by default, so the never-delivered stall clock is not the
  // thing under test unless a case sets it deliberately.
  agentFirstSeenAt: ago(180 * 24 * 60 * 60 * 1000),
  ...over,
});

describe("planAgentLivenessScan", () => {
  it("produces exactly one decision per input row", () => {
    const out = planAgentLivenessScan(
      [
        row({ clinicId: "a" }),
        row({ clinicId: "b", linkStatus: "disconnected" }),
        row({ clinicId: "c", linkStatus: null }),
      ],
      NOW
    );
    expect(out.map((d) => d.clinicId)).toEqual(["a", "b", "c"]);
  });

  it("returns no conditions for a healthy connected agent", () => {
    const [d] = planAgentLivenessScan([row()], NOW);
    expect(d.conditions).toEqual([]);
    expect(d.skippedByLinkStatus).toBe(false);
  });

  it("raises heartbeat_stale once the agent stops reporting", () => {
    const [d] = planAgentLivenessScan(
      [row({ lastHeartbeatAt: ago(HEARTBEAT_STALE_MS + 60_000) })],
      NOW
    );
    expect(d.conditions.map((c) => c.key)).toEqual(["heartbeat_stale"]);
  });

  it("raises silent_stall when the agent beats but delivers nothing", () => {
    const [d] = planAgentLivenessScan(
      [row({ lastEventAt: STALLED_EVENT_AT })],
      NOW
    );
    expect(d.conditions.map((c) => c.key)).toEqual(["silent_stall"]);
  });

  it("never reports both conditions at once: a silent agent explains the stall", () => {
    const [d] = planAgentLivenessScan(
      [
        row({
          lastHeartbeatAt: ago(HEARTBEAT_STALE_MS + 60_000),
          lastEventAt: STALLED_EVENT_AT,
        }),
      ],
      NOW
    );
    expect(d.conditions.map((c) => c.key)).toEqual(["heartbeat_stale"]);
  });

  it("stall-alerts a long-enrolled clinic that has NEVER sent an event", () => {
    // lastEventAt stays null forever for an install that never worked once.
    // Exempting that case would exempt the worst outcome there is from the
    // only check designed to catch it, so the clock falls back to enrollment.
    const [d] = planAgentLivenessScan([row({ lastEventAt: null })], NOW);
    expect(d.conditions.map((c) => c.key)).toEqual(["silent_stall"]);
  });

  it("gives a freshly enrolled clinic a grace period", () => {
    const [d] = planAgentLivenessScan(
      [row({ lastEventAt: null, agentFirstSeenAt: ago(24 * 60 * 60 * 1000) })],
      NOW
    );
    expect(d.conditions).toEqual([]);
  });

  it.each([
    "unconfigured",
    "akkreditierung",
    "pending",
    "error",
    "disconnected",
  ])("skips evaluation for a %s link but still reconciles it", (status) => {
    const [d] = planAgentLivenessScan(
      [
        row({
          linkStatus: status,
          lastHeartbeatAt: ago(HEARTBEAT_STALE_MS * 10),
          lastEventAt: STALLED_EVENT_AT,
        }),
      ],
      NOW
    );
    // Empty conditions plus a decision row is what clears a leftover alert.
    expect(d.skippedByLinkStatus).toBe(true);
    expect(d.conditions).toEqual([]);
  });

  it("skips a clinic whose link row is missing entirely", () => {
    const [d] = planAgentLivenessScan(
      [
        row({
          linkStatus: null,
          lastHeartbeatAt: ago(HEARTBEAT_STALE_MS * 10),
        }),
      ],
      NOW
    );
    expect(d.skippedByLinkStatus).toBe(true);
    expect(d.conditions).toEqual([]);
  });

  it("returns an empty plan for an empty scan", () => {
    expect(planAgentLivenessScan([], NOW)).toEqual([]);
  });
});
