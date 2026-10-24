import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Finding 11: the RED webhook must not tell an outsider which linkIds exist
 * (same 401 for an unknown link and a bad secret) and must bound the DB lookups
 * an unauthenticated caller can cause (per-IP token bucket in front of them).
 */

vi.mock("../db/client.js", () => ({
  db: vi.fn(),
  INACTIVE_LINK_STATUSES: new Set(["unconfigured", "error", "disconnected"]),
}));
vi.mock("../portal-client.js", () => ({ postAll: vi.fn() }));
vi.mock("../adapters/red/index.js", () => ({
  redAdapter: { decodePush: vi.fn(() => []) },
}));

import { db } from "../db/client.js";
import { redWebhook, _resetRedRateLimit } from "./red-webhook.js";

const SECRET = "s3cr3t-per-clinic-outbound-token";
const RAW = JSON.stringify({ resourceType: "Bundle", entry: [] });

function mockRows(rows: Array<Record<string, unknown>>) {
  const query = vi.fn(() => Promise.resolve(rows));
  vi.mocked(db).mockReturnValue(query as unknown as ReturnType<typeof db>);
  return query;
}
const linkRow = (over: Record<string, unknown> = {}) => ({
  id: "link-1",
  clinic_id: "clinic-1",
  pvs_vendor: "red",
  status: "connected",
  preferred_path: "auto",
  connection_config: { outboundSecret: SECRET },
  ...over,
});

function makeReply() {
  const r = {
    statusCode: 0,
    payload: undefined as unknown,
    headers: {} as Record<string, unknown>,
    code(c: number) {
      r.statusCode = c;
      return r;
    },
    header(k: string, v: unknown) {
      r.headers[k] = v;
      return r;
    },
    send(p: unknown) {
      r.payload = p;
      return r;
    },
  };
  return r;
}
function makeReq(headers: Record<string, string>, ip = "203.0.113.7") {
  return {
    params: { linkId: "link-1" },
    headers: { "fly-client-ip": ip, ...headers },
    ip: "10.0.0.1",
    body: RAW,
  } as never;
}
async function call(headers: Record<string, string>, ip?: string) {
  const reply = makeReply();
  await redWebhook(makeReq(headers, ip), reply as never);
  return reply;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRedRateLimit();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("no link enumeration", () => {
  it("an unknown linkId, a non-RED link and a wrong secret all answer with the identical 401", async () => {
    mockRows([]);
    const unknown = await call({ "x-red-secret": SECRET });
    mockRows([linkRow({ pvs_vendor: "tomedo" })]);
    const otherVendor = await call({ "x-red-secret": SECRET });
    mockRows([linkRow()]);
    const badSecret = await call({ "x-red-secret": "wrong" });
    mockRows([linkRow()]);
    const noCredentials = await call({});

    for (const r of [unknown, otherVendor, badSecret, noCredentials]) {
      expect(r.statusCode).toBe(401);
      expect(r.payload).toEqual({ error: "bad_signature" });
    }
  });

  it("a RED link that has no outbound secret yet is not distinguishable either", async () => {
    mockRows([linkRow({ connection_config: {} })]);
    const r = await call({ "x-red-secret": "anything" });
    expect(r.statusCode).toBe(401);
    expect(r.payload).toEqual({ error: "bad_signature" });
  });

  it("a correct secret still works", async () => {
    mockRows([linkRow()]);
    const r = await call({ "x-red-secret": SECRET });
    expect(r.statusCode).toBe(200);
  });
});

describe("per-IP rate limit in front of the DB lookup", () => {
  it("after the burst allowance an IP gets 429 and no further DB queries are made", async () => {
    const query = mockRows([]);
    let first429 = -1;
    for (let i = 0; i < 200; i++) {
      const r = await call({ "x-red-secret": "x" });
      if (r.statusCode === 429) {
        first429 = i;
        expect(r.payload).toEqual({ error: "rate_limited" });
        expect(r.headers["retry-after"]).toBeDefined();
        break;
      }
    }
    expect(first429).toBeGreaterThan(20); // a legitimate burst of deliveries is fine
    expect(first429).toBeLessThan(200);
    const queriesAtLimit = query.mock.calls.length;
    expect(queriesAtLimit).toBe(first429); // the limited request never reached the DB
    await call({ "x-red-secret": "x" });
    await call({ "x-red-secret": "x" });
    expect(query.mock.calls.length).toBe(queriesAtLimit);
  });

  it("other IPs are unaffected", async () => {
    mockRows([linkRow()]);
    for (let i = 0; i < 300; i++) await call({ "x-red-secret": "bad" }, "198.51.100.1");
    const other = await call({ "x-red-secret": SECRET }, "198.51.100.2");
    expect(other.statusCode).toBe(200);
  });

  it("the bucket refills over time", async () => {
    vi.useFakeTimers();
    mockRows([]);
    for (let i = 0; i < 300; i++) await call({}, "198.51.100.3");
    expect((await call({}, "198.51.100.3")).statusCode).toBe(429);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await call({}, "198.51.100.3")).statusCode).toBe(401);
  });

  it("falls back to the socket address when no proxy header is present", async () => {
    mockRows([]);
    const reply = makeReply();
    await redWebhook({ params: { linkId: "x" }, headers: {}, ip: "192.0.2.9", body: RAW } as never, reply as never);
    expect(reply.statusCode).toBe(401);
  });
});
