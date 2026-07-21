import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * M-S3: a webhook bundle that PARTIALLY fails to post to the portal must be
 * retried (5xx), not acked with 200. Previously only an all-events-failed
 * bundle returned 503, so any bundle where some events posted and some failed
 * was silently ack'd and the failed events were lost.
 *
 * M-S7: a malformed-but-correctly-signed body must be dropped with a
 * non-retryable 400, not a 500. A 500 makes the FHIR Subscription redeliver the
 * same poison delivery forever.
 */

vi.mock("../db/client.js", () => ({
  db: vi.fn(),
  getLinkByClinicAndVendor: vi.fn(),
  // The webhook imports this; the concurrent inactive-link guard uses it.
  INACTIVE_LINK_STATUSES: new Set(["unconfigured", "error", "disconnected"]),
}));
vi.mock("../portal-client.js", () => ({ postAll: vi.fn() }));
vi.mock("../adapters/healthhub/index.js", () => ({
  healthHubAdapter: { decodePush: vi.fn() },
}));
vi.mock("../adapters/red/index.js", () => ({
  redAdapter: { decodePush: vi.fn() },
}));

import { db } from "../db/client.js";
import { postAll } from "../portal-client.js";
import { healthHubAdapter } from "../adapters/healthhub/index.js";
import { redAdapter } from "../adapters/red/index.js";
import { healthHubWebhook } from "./healthhub-webhook.js";
import { redWebhook } from "./red-webhook.js";

const SECRET = "s3cr3t-per-clinic-outbound-token";
const RAW = JSON.stringify({ resourceType: "Bundle", entry: [] });

function mockLinkRow(vendor: string, status = "connected") {
  vi.mocked(db).mockReturnValue(
    (() =>
      Promise.resolve([
        {
          id: "link-1",
          clinic_id: "clinic-1",
          pvs_vendor: vendor,
          status,
          preferred_path: "auto",
          connection_config: { outboundSecret: SECRET },
        },
      ])) as unknown as ReturnType<typeof db>
  );
}

function makeReply() {
  const r = {
    statusCode: 0,
    payload: undefined as unknown,
    code(c: number) {
      r.statusCode = c;
      return r;
    },
    send(p: unknown) {
      r.payload = p;
      return r;
    },
  };
  return r;
}

function makeReq() {
  return {
    params: { linkId: "link-1" },
    headers: { "x-healthhub-secret": SECRET, "x-red-secret": SECRET },
    body: RAW,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

function twoEvents() {
  return [
    { kind: "PatientUpserted" },
    { kind: "PatientUpserted" },
  ] as never[];
}

describe("healthHubWebhook delivery outcomes", () => {
  it("M-S3: returns a retryable 503 when SOME (not all) events fail to post", async () => {
    mockLinkRow("healthhub");
    vi.mocked(healthHubAdapter.decodePush!).mockReturnValue(twoEvents());
    vi.mocked(postAll).mockResolvedValue({ ingested: 1, deduped: 0, errors: 1 });
    const reply = makeReply();
    await healthHubWebhook(makeReq(), reply as never);
    expect(reply.statusCode).toBe(503);
  });

  it("returns 200 when every event posts cleanly", async () => {
    mockLinkRow("healthhub");
    vi.mocked(healthHubAdapter.decodePush!).mockReturnValue(twoEvents());
    vi.mocked(postAll).mockResolvedValue({ ingested: 2, deduped: 0, errors: 0 });
    const reply = makeReply();
    await healthHubWebhook(makeReq(), reply as never);
    expect(reply.statusCode).toBe(200);
  });

  it("M-S7: returns a non-retryable 400 when the body cannot be decoded", async () => {
    mockLinkRow("healthhub");
    vi.mocked(healthHubAdapter.decodePush!).mockImplementation(() => {
      throw new Error("body is not valid JSON");
    });
    const reply = makeReply();
    await healthHubWebhook(makeReq(), reply as never);
    expect(reply.statusCode).toBe(400);
    expect(postAll).not.toHaveBeenCalled();
  });
});

describe("redWebhook delivery outcomes", () => {
  it("M-S3: returns a retryable 503 when SOME (not all) events fail to post", async () => {
    mockLinkRow("red");
    vi.mocked(redAdapter.decodePush!).mockReturnValue(twoEvents());
    vi.mocked(postAll).mockResolvedValue({ ingested: 1, deduped: 0, errors: 1 });
    const reply = makeReply();
    await redWebhook(makeReq(), reply as never);
    expect(reply.statusCode).toBe(503);
  });

  it("M-S7: returns a non-retryable 400 when the body cannot be decoded", async () => {
    mockLinkRow("red");
    vi.mocked(redAdapter.decodePush!).mockImplementation(() => {
      throw new Error("body is not valid JSON");
    });
    const reply = makeReply();
    await redWebhook(makeReq(), reply as never);
    expect(reply.statusCode).toBe(400);
    expect(postAll).not.toHaveBeenCalled();
  });
});
