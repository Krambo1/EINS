import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  _setStateDbForTesting,
  recordDrift,
  pendingDriftReports,
} from "./framework.js";
import {
  bridgeSourceForVendor,
  publishPendingDrift,
} from "./drift-publisher.js";

const CLINIC = "11111111-1111-1111-1111-111111111111";
const PORTAL = "https://portal.example";

beforeEach(() => {
  const handle = new Database(":memory:");
  handle.exec(`
    CREATE TABLE db_adapter_state (
      vendor_id TEXT NOT NULL,
      stream_kind TEXT NOT NULL,
      cursor TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      last_run_at INTEGER,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      next_run_at INTEGER NOT NULL DEFAULT 0,
      column_snapshot TEXT,
      PRIMARY KEY (vendor_id, stream_kind)
    );
    CREATE TABLE db_adapter_drift (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id TEXT NOT NULL,
      stream_kind TEXT NOT NULL,
      expected TEXT NOT NULL,
      observed TEXT NOT NULL,
      missing TEXT NOT NULL,
      added TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      reported_to_portal INTEGER NOT NULL DEFAULT 0
    );
  `);
  _setStateDbForTesting(handle);
});

function seedDrift(vendorId: string, streamKind: string): void {
  recordDrift({
    vendorId,
    streamKind: streamKind as "AppointmentCreated",
    expectedColumns: ["id", "patient_id", "termin_zeit", "modified_at"],
    observedColumns: ["id", "patient_id", "appointment_time", "modified_at"],
    missing: ["termin_zeit"],
    added: ["appointment_time"],
    detectedAt: "2026-05-21T10:00:00.000Z",
  });
}

function mockConfig() {
  return async () => ({ clinicId: CLINIC, portalBaseUrl: PORTAL });
}
function mockSecret(value: string | null = "deadbeef") {
  return async () => value;
}

describe("drift-publisher: vendor → bridge_source mapping", () => {
  it("maps tomedo-db to the tomedo bridge_source", () => {
    expect(bridgeSourceForVendor("tomedo-db")).toBe("tomedo");
  });
  it("maps the GDT-flavored db adapters to gdt_agent", () => {
    expect(bridgeSourceForVendor("medatixx")).toBe("gdt_agent");
    expect(bridgeSourceForVendor("cgm-albis")).toBe("gdt_agent");
    expect(bridgeSourceForVendor("indamed")).toBe("gdt_agent");
  });
  it("maps both cgm-m1pro engine variants to gdt_agent (mssql + oracle)", () => {
    expect(bridgeSourceForVendor("cgm-m1pro")).toBe("gdt_agent");
    expect(bridgeSourceForVendor("cgm-m1pro-oracle-db")).toBe("gdt_agent");
  });
  it("falls back to gdt_agent for unknown vendors", () => {
    expect(bridgeSourceForVendor("future-vendor")).toBe("gdt_agent");
  });
});

describe("drift-publisher: publish loop", () => {
  it("is a no-op when no pending drift exists", async () => {
    const outcome = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(),
      fetchImpl: (async () => {
        throw new Error("must not call fetch");
      }) as unknown as typeof fetch,
    });
    expect(outcome.attempted).toBe(0);
    expect(outcome.delivered).toBe(0);
  });

  it("does nothing when no secret is loaded", async () => {
    seedDrift("tomedo-db", "AppointmentCreated");
    const outcome = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(null),
      fetchImpl: (async () => {
        throw new Error("must not call fetch");
      }) as unknown as typeof fetch,
    });
    expect(outcome.attempted).toBe(0);
    expect(pendingDriftReports()).toHaveLength(1);
  });

  it("POSTs a signed drift envelope, marks the row reported on 2xx", async () => {
    seedDrift("tomedo-db", "AppointmentCreated");
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true, status: "inserted", id: "x" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const outcome = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(),
      fetchImpl: fakeFetch,
    });

    expect(outcome.attempted).toBe(1);
    expect(outcome.delivered).toBe(1);
    expect(outcome.deferred).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${PORTAL}/api/pvs/health`);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["x-eins-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.clinicId).toBe(CLINIC);
    expect(body.pvsVendor).toBe("tomedo-db");
    expect(body.bridgeSource).toBe("tomedo");
    expect(body.streamKind).toBe("AppointmentCreated");
    expect(body.eventKind).toBe("schema_drift");
    expect(body.detail.missing).toEqual(["termin_zeit"]);
    expect(body.detail.added).toEqual(["appointment_time"]);
    expect(body.detectedAt).toBe("2026-05-21T10:00:00.000Z");
    expect(pendingDriftReports()).toHaveLength(0);
  });

  it("defers on 429 / 5xx; the row stays in the queue", async () => {
    seedDrift("medatixx", "PatientUpserted");
    let call = 0;
    const fakeFetch = (async () => {
      call++;
      // First call: 429 (rate-limited). Second call (next tick): 201 OK.
      if (call === 1) return new Response("{}", { status: 429 });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;

    const first = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(),
      fetchImpl: fakeFetch,
    });
    expect(first.delivered).toBe(0);
    expect(first.deferred).toBe(1);
    expect(pendingDriftReports()).toHaveLength(1);

    const second = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(),
      fetchImpl: fakeFetch,
    });
    expect(second.delivered).toBe(1);
    expect(pendingDriftReports()).toHaveLength(0);
  });

  it("marks reported on non-retryable 4xx so it does not loop forever", async () => {
    seedDrift("medatixx", "AppointmentCreated");
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { code: "vendor_mismatch" } }), {
        status: 409,
      })) as unknown as typeof fetch;

    const outcome = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(),
      fetchImpl: fakeFetch,
    });
    expect(outcome.delivered).toBe(0);
    expect(outcome.failed).toBe(1);
    expect(pendingDriftReports()).toHaveLength(0);
  });

  it("treats network errors as deferred (retried next tick)", async () => {
    seedDrift("cgm-albis", "InvoicePaid");
    const fakeFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const outcome = await publishPendingDrift({
      configLoader: mockConfig(),
      secretLoader: mockSecret(),
      fetchImpl: fakeFetch,
    });
    expect(outcome.deferred).toBe(1);
    expect(pendingDriftReports()).toHaveLength(1);
  });
});
