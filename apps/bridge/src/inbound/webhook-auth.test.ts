import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * H16: FHIR rest-hook servers replay the Subscription's channel.header
 * verbatim (a PLAINTEXT secret), they do not compute a body-HMAC. The inbound
 * verifier must accept that echoed secret (x-<vendor>-secret) via a
 * timing-safe comparison, while still accepting a body-HMAC signature header
 * as an additional path.
 */

vi.mock("../db/client.js", () => ({
  db: vi.fn(),
  getLinkByClinicAndVendor: vi.fn(),
  // Mirror the real set so the webhooks' status gate behaves as in prod.
  INACTIVE_LINK_STATUSES: new Set(["unconfigured", "error", "disconnected"]),
}));
vi.mock("../portal-client.js", () => ({ postAll: vi.fn() }));
vi.mock("../adapters/healthhub/index.js", () => ({
  healthHubAdapter: { decodePush: vi.fn(() => []) },
}));
vi.mock("../adapters/red/index.js", () => ({
  redAdapter: { decodePush: vi.fn(() => []) },
}));

import { db } from "../db/client.js";
import { signBody } from "../canonical/sign.js";
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

function makeReq(headers: Record<string, string>) {
  return {
    params: { linkId: "link-1" },
    headers,
    body: RAW,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("healthHubWebhook auth (H16)", () => {
  it("accepts the echoed plaintext secret in x-healthhub-secret", async () => {
    mockLinkRow("healthhub");
    const reply = makeReply();
    await healthHubWebhook(makeReq({ "x-healthhub-secret": SECRET }), reply as never);
    expect(reply.statusCode).toBe(200);
  });

  it("accepts a leading-space echoed secret (header whitespace insignificant)", async () => {
    mockLinkRow("healthhub");
    const reply = makeReply();
    await healthHubWebhook(
      makeReq({ "x-healthhub-secret": ` ${SECRET}` }),
      reply as never
    );
    expect(reply.statusCode).toBe(200);
  });

  it("rejects a wrong echoed secret with 401", async () => {
    mockLinkRow("healthhub");
    const reply = makeReply();
    await healthHubWebhook(
      makeReq({ "x-healthhub-secret": "wrong-secret" }),
      reply as never
    );
    expect(reply.statusCode).toBe(401);
  });

  it("still accepts a valid body-HMAC signature (defense in depth)", async () => {
    mockLinkRow("healthhub");
    const reply = makeReply();
    await healthHubWebhook(
      makeReq({ "x-healthhub-signature": signBody(RAW, SECRET) }),
      reply as never
    );
    expect(reply.statusCode).toBe(200);
  });

  it("rejects when neither secret nor signature is present", async () => {
    mockLinkRow("healthhub");
    const reply = makeReply();
    await healthHubWebhook(makeReq({}), reply as never);
    expect(reply.statusCode).toBe(401);
  });
});

describe("redWebhook auth (H16)", () => {
  it("accepts the echoed plaintext secret in x-red-secret", async () => {
    mockLinkRow("red");
    const reply = makeReply();
    await redWebhook(makeReq({ "x-red-secret": SECRET }), reply as never);
    expect(reply.statusCode).toBe(200);
  });

  it("rejects a wrong echoed secret with 401", async () => {
    mockLinkRow("red");
    const reply = makeReply();
    await redWebhook(makeReq({ "x-red-secret": "nope" }), reply as never);
    expect(reply.statusCode).toBe(401);
  });

  it("still accepts a valid body-HMAC signature", async () => {
    mockLinkRow("red");
    const reply = makeReply();
    await redWebhook(
      makeReq({ "x-red-signature": signBody(RAW, SECRET) }),
      reply as never
    );
    expect(reply.statusCode).toBe(200);
  });
});

/**
 * L24: an authenticated delivery for a link that is not active (disabled,
 * errored, disconnected) must be ignored, not processed. We ack with 200 so
 * the vendor's FHIR Subscription treats it as delivered and stops retrying a
 * dead link (a non-2xx would retry-storm). The status gate sits AFTER auth so
 * an unauthenticated caller can't probe a link's status.
 */
describe("inactive-link handling (L24)", () => {
  for (const status of ["error", "disconnected", "unconfigured"]) {
    it(`healthhub: ignores a valid delivery for a ${status} link with 200`, async () => {
      mockLinkRow("healthhub", status);
      const reply = makeReply();
      await healthHubWebhook(
        makeReq({ "x-healthhub-secret": SECRET }),
        reply as never
      );
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toMatchObject({ ignored: true, reason: "link_inactive" });
      // decodePush must not have been consulted for a dead link.
      expect(vi.mocked(healthHubAdapter.decodePush!)).not.toHaveBeenCalled();
    });

    it(`red: ignores a valid delivery for a ${status} link with 200`, async () => {
      mockLinkRow("red", status);
      const reply = makeReply();
      await redWebhook(makeReq({ "x-red-secret": SECRET }), reply as never);
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toMatchObject({ ignored: true, reason: "link_inactive" });
      expect(vi.mocked(redAdapter.decodePush!)).not.toHaveBeenCalled();
    });
  }

  it("healthhub: still processes a pending link (portal quarantines, 0045)", async () => {
    mockLinkRow("healthhub", "pending");
    const reply = makeReply();
    await healthHubWebhook(makeReq({ "x-healthhub-secret": SECRET }), reply as never);
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).not.toMatchObject({ ignored: true });
    expect(vi.mocked(healthHubAdapter.decodePush!)).toHaveBeenCalledOnce();
  });

  it("still rejects an inactive link with a bad secret via 401 (auth first)", async () => {
    mockLinkRow("healthhub", "disconnected");
    const reply = makeReply();
    await healthHubWebhook(makeReq({ "x-healthhub-secret": "wrong" }), reply as never);
    expect(reply.statusCode).toBe(401);
  });
});
