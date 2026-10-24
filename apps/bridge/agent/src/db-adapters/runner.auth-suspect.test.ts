import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthError, isAmbiguousAuthError } from "./error-classes.js";
import { defaultConfigsDir, startRunner, type RunnerHandle } from "./runner.js";
import { _setStateDbForTesting } from "./framework.js";
import { freshStateDb } from "./review-support.js";
import type { DbConnectionParams, DbDriver, QueryResult } from "./types.js";

/** Finding 1: an MSSQL login-phase error is ambiguous (DB recovering vs wrong
 *  password) and must not latch auth_failed forever. */

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-07T08:00:00Z");

class ScriptedConnect implements DbDriver {
  readonly engine = "mssql" as const;
  static attempts = 0;
  static script: Array<() => Error | null> = [];
  async connect(_p: DbConnectionParams): Promise<void> {
    ScriptedConnect.attempts += 1;
    const step = ScriptedConnect.script.shift();
    const err = step ? step() : null;
    if (err) throw err;
  }
  async query(): Promise<QueryResult> {
    return { columns: [], rows: [] };
  }
  async close(): Promise<void> {}
  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
}

const elogin = () =>
  Object.assign(new Error("Login failed for user 'eins'. Database unavailable"), {
    code: "ELOGIN",
    number: 4060,
  });

describe("finding 1: ambiguous MSSQL login errors", () => {
  let handle: RunnerHandle | null = null;
  beforeEach(() => {
    freshStateDb();
    ScriptedConnect.attempts = 0;
  });
  afterEach(async () => {
    if (handle) await handle.stop();
    handle = null;
    _setStateDbForTesting(null);
  });

  it("classifies ELOGIN / 18456 / 4060 as ambiguous and 28P01 / 1045 / ORA-01017 as hard", () => {
    expect(isAmbiguousAuthError(elogin())).toBe(true);
    expect(isAmbiguousAuthError(Object.assign(new Error("x"), { number: 18456 }))).toBe(true);
    expect(isAmbiguousAuthError(Object.assign(new Error("x"), { number: 4060 }))).toBe(true);
    expect(isAuthError(elogin())).toBe(true); // still visible as auth_failed
    expect(isAmbiguousAuthError(Object.assign(new Error("x"), { code: "28P01" }))).toBe(false);
    expect(isAmbiguousAuthError(Object.assign(new Error("x"), { errno: 1045 }))).toBe(false);
    expect(isAmbiguousAuthError(new Error("ORA-01017: invalid username/password"))).toBe(false);
  });

  it("reports auth_failed, retries at most once per 6 h, and recovers without a credential change", async () => {
    ScriptedConnect.script = [elogin];
    const clock = { t: NOW };
    handle = await startRunner({
      clinicId: "11111111-1111-1111-1111-111111111111",
      enabledVendors: ["tomedo-db"],
      connections: { "tomedo-db": { host: "h", username: "u" } },
      driverFactory: () => new ScriptedConnect(),
      credentialLoader: async () => "correct-password",
      tickMs: 3_600_000,
      now: () => clock.t,
      remoteConfigs: new Map(),
      configsDir: defaultConfigsDir(),
    });
    await handle.tickOnce();
    expect(ScriptedConnect.attempts).toBe(1);
    expect(handle.statusSnapshot().every((s) => s.status === "auth_failed")).toBe(true);

    // Inside the 6 h window: never another attempt.
    for (const h of [1, 2, 3, 4, 5]) {
      clock.t = NOW + h * HOUR;
      await handle.tickOnce();
    }
    expect(ScriptedConnect.attempts).toBe(1);

    // After 7 h: exactly one more attempt, which connects. No permanent latch.
    clock.t = NOW + 7 * HOUR;
    await handle.tickOnce();
    expect(ScriptedConnect.attempts).toBe(2);
    expect(handle.statusSnapshot().some((s) => s.status === "auth_failed")).toBe(false);
  });

  it("a second ELOGIN re-latches and waits another full 6 h", async () => {
    ScriptedConnect.script = [elogin, elogin];
    const clock = { t: NOW };
    handle = await startRunner({
      clinicId: "11111111-1111-1111-1111-111111111111",
      enabledVendors: ["tomedo-db"],
      connections: { "tomedo-db": { host: "h", username: "u" } },
      driverFactory: () => new ScriptedConnect(),
      credentialLoader: async () => "pw",
      tickMs: 3_600_000,
      now: () => clock.t,
      remoteConfigs: new Map(),
      configsDir: defaultConfigsDir(),
    });
    await handle.tickOnce();
    clock.t = NOW + 7 * HOUR;
    await handle.tickOnce();
    expect(ScriptedConnect.attempts).toBe(2);
    expect(handle.statusSnapshot().every((s) => s.status === "auth_failed")).toBe(true);
    clock.t = NOW + 12 * HOUR; // only 5 h after the second failure
    await handle.tickOnce();
    expect(ScriptedConnect.attempts).toBe(2);
    clock.t = NOW + 14 * HOUR;
    await handle.tickOnce();
    expect(ScriptedConnect.attempts).toBe(3);
  });
});
