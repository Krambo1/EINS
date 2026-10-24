import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setStateDbForTesting, loadState, pollOnce } from "./framework.js";
import { freshStateDb } from "./review-support.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import type { DbDriver, QueryResult } from "./types.js";

/**
 * Finding 7: per-row enqueue() is one autocommit fsync per row (2.8 ms/row) and
 * stalls the event loop for seconds on a 5000-row batch. The framework must
 * collect the batch and call enqueueMany once, advancing the cursor only after
 * it returned.
 */

const h = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueMany: vi.fn(),
}));

vi.mock("../outbox.js", () => ({
  enqueue: h.enqueue,
  enqueueMany: h.enqueueMany,
  outboxConnection: () => {
    throw new Error("state db must be injected in this test");
  },
}));

const YAML = `
vendor: bulk-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: bulk-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
    query: |
      SELECT id, patient_id, termin_zeit, modified_at FROM termin
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND termin.id > :cursorTiebreak))
      ORDER BY modified_at ASC, termin.id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "bulk:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

const COLS = ["id", "patient_id", "termin_zeit", "modified_at"];
const NOW = Date.parse("2026-06-10T10:00:00Z");

function rows(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    patient_id: String(100 + i),
    termin_zeit: "2026-06-20T10:00:00Z",
    modified_at: new Date(NOW - 3_600_000 + i * 1000),
  }));
}

class FixedDriver implements DbDriver {
  readonly engine = "postgres" as const;
  constructor(private readonly data: Array<Record<string, unknown>>) {}
  async connect(): Promise<void> {}
  async query(): Promise<QueryResult> {
    return { columns: COLS, rows: this.data };
  }
  async close(): Promise<void> {}
  async healthCheck(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

beforeEach(() => {
  freshStateDb();
  h.enqueue.mockReset();
  h.enqueueMany.mockReset();
  h.enqueueMany.mockImplementation((items: unknown[]) => ({
    inserted: items.length,
    duplicates: 0,
  }));
});
afterEach(() => _setStateDbForTesting(null));

describe("finding 7: one enqueueMany per batch", () => {
  it("writes a 500-row batch with exactly one enqueueMany call and no per-row enqueue", async () => {
    const vendor = await loadVendorConfigFromString(YAML, "bulk.yaml");
    const out = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver: new FixedDriver(rows(500)),
      now: () => NOW,
    });
    expect(out.emitted).toBe(500);
    expect(h.enqueueMany).toHaveBeenCalledTimes(1);
    expect(h.enqueue).not.toHaveBeenCalled();
    const items = h.enqueueMany.mock.calls[0][0] as Array<{ payload: string; contentHash: string }>;
    expect(items).toHaveLength(500);
    expect(items[0].contentHash).toBe(JSON.parse(items[0].payload).pvsExternalEventId);
    expect(loadState("bulk-db", "AppointmentCreated").cursor).not.toBe("");
  });

  it("does not advance the cursor when enqueueMany throws, and re-reads the batch later", async () => {
    h.enqueueMany.mockImplementation(() => {
      throw new Error("disk full");
    });
    const vendor = await loadVendorConfigFromString(YAML, "bulk.yaml");
    const out = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver: new FixedDriver(rows(50)),
      now: () => NOW,
    });
    expect(out.emitted).toBe(0);
    const state = loadState("bulk-db", "AppointmentCreated");
    expect(state.cursor).toBe("");
    expect(state.lastError).toMatch(/outbox enqueue failed: disk full/);
    expect(state.consecutiveFailures).toBe(1);
  });
});
