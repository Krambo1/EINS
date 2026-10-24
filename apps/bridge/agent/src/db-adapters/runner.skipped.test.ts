import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../outbox.js", () => ({
  enqueue: () => undefined,
  enqueueMany: (items: unknown[]) => ({ inserted: items.length, duplicates: 0 }),
  outboxConnection: () => {
    throw new Error("state db must be injected in this test");
  },
}));

import { defaultConfigsDir, startRunner, type RunnerHandle } from "./runner.js";
import { _setStateDbForTesting } from "./framework.js";
import { freshStateDb } from "./review-support.js";
import type { DbDriver, QueryResult } from "./types.js";

/** Finding 11: skipped (unmappable) rows must reach the heartbeat status, not
 *  only the local log. */

const COLS = [
  "id",
  "patient_id",
  "termin_zeit",
  "behandlung_code",
  "behandlung_name",
  "raum_id",
  "raum_name",
  "kommentar",
  "modified_at",
];

function appointmentRows(): Array<Record<string, unknown>> {
  const base = Date.now() - 3_600_000;
  return Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    patient_id: String(100 + i),
    // Row 3 has no appointment time: occurredAt cannot be resolved -> skipped.
    termin_zeit: i === 2 ? null : "2026-06-20T10:00:00Z",
    behandlung_code: null,
    behandlung_name: null,
    raum_id: null,
    raum_name: null,
    kommentar: null,
    modified_at: new Date(base + i * 1000),
  }));
}

class AppointmentDriver implements DbDriver {
  readonly engine = "postgres" as const;
  async connect(): Promise<void> {}
  async query(sql: string): Promise<QueryResult> {
    // Only the AppointmentCreated stream selects behandlung_code from termin.
    if (/FROM termin/i.test(sql) && /behandlung_code/i.test(sql)) {
      return { columns: COLS, rows: appointmentRows() };
    }
    return { columns: [], rows: [] };
  }
  async close(): Promise<void> {}
  async healthCheck(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

describe("finding 11: skippedRows on the stream status", () => {
  let handle: RunnerHandle | null = null;
  beforeEach(() => freshStateDb());
  afterEach(async () => {
    if (handle) await handle.stop();
    handle = null;
    _setStateDbForTesting(null);
  });

  it("reports a cumulative skippedRows count and a reason category (no cell values)", async () => {
    handle = await startRunner({
      clinicId: "11111111-1111-1111-1111-111111111111",
      enabledVendors: ["tomedo-db"],
      connections: { "tomedo-db": { host: "h", username: "u" } },
      driverFactory: () => new AppointmentDriver(),
      credentialLoader: async () => "pw",
      tickMs: 3_600_000,
      remoteConfigs: new Map(),
      configsDir: defaultConfigsDir(),
    });
    await handle.tickOnce();
    const appt = handle.statusSnapshot().find((s) => s.stream === "AppointmentCreated");
    expect(appt?.skippedRows).toBe(1);
    expect(appt?.lastSkipReason).toBe("missing_required_field");
    // Other streams report zero.
    const other = handle.statusSnapshot().find((s) => s.stream === "RecallScheduled");
    expect(other?.skippedRows).toBe(0);
    expect(other?.lastSkipReason).toBeNull();
  });
});
