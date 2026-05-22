import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PabauClient } from "./client.js";
import type { PvsLinkRow } from "../../db/client.js";

/**
 * Pabau HTTP client: token mode, paginated streams, 429 backoff with
 * Retry-After honored. We stub global fetch to avoid network I/O.
 */

const CLINIC = "00000000-0000-0000-0000-000000000001";

function linkWithApiToken(extra: Record<string, unknown> = {}): PvsLinkRow {
  return {
    id: "link-1",
    clinicId: CLINIC,
    pvsVendor: "pabau",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: {
      pabauEndpoint: "https://api.oauth.pabau.com/api/v1",
      pabauApiToken: "tok-abc",
      ...extra,
    },
  };
}

function mockResponse(
  body: unknown,
  init: ResponseInit & { headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("PabauClient.from", () => {
  it("throws when neither api_token nor OAuth credentials are present", () => {
    const link: PvsLinkRow = {
      id: "x",
      clinicId: CLINIC,
      pvsVendor: "pabau",
      status: "connected",
      preferredPath: "auto",
      connectionConfig: { pabauEndpoint: "https://api.oauth.pabau.com/api/v1" },
    };
    expect(() => PabauClient.from(link)).toThrow(/missing/);
  });

  it("constructs a default endpoint when only pabauApiPath is given", () => {
    const link: PvsLinkRow = {
      id: "x",
      clinicId: CLINIC,
      pvsVendor: "pabau",
      status: "connected",
      preferredPath: "auto",
      connectionConfig: { pabauApiPath: "api/v2", pabauApiToken: "tok" },
    };
    const client = PabauClient.from(link);
    expect(client).toBeInstanceOf(PabauClient);
  });
});

describe("PabauClient: pagination + auth", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("sends Bearer api_token in Authorization header and walks pages until short page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      modified_at: "2026-05-21T00:00:00.000Z",
    }));
    const page2 = [{ id: 101, modified_at: "2026-05-21T00:00:00.000Z" }];

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ data: page1, total: 101 }))
      .mockResolvedValueOnce(mockResponse({ data: page2, total: 101 }));

    const client = PabauClient.from(linkWithApiToken());
    const seen: unknown[] = [];
    for await (const p of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      seen.push(p);
    }
    expect(seen).toHaveLength(101);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstCall = fetchSpy.mock.calls[0]!;
    const url = firstCall[0] as string;
    expect(url).toContain("/patients");
    expect(url).toContain("modified_since=1970-01-01T00%3A00%3A00.000Z");
    expect(url).toContain("page=1");
    expect(url).toContain("per_page=100");

    const init = firstCall[1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe("Bearer tok-abc");
    expect(init.headers.accept).toBe("application/json");
  });

  it("accepts `items` envelope in addition to `data`", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({
        items: [{ id: 1, modified_at: "2026-05-21T00:00:00.000Z" }],
      })
    );
    const client = PabauClient.from(linkWithApiToken());
    const seen: unknown[] = [];
    for await (const p of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      seen.push(p);
    }
    expect(seen).toHaveLength(1);
  });

  it("honors Retry-After on HTTP 429 and retries", async () => {
    const sleepSpy = vi
      .spyOn(globalThis, "setTimeout")
      // immediate execution so we don't wait the full 1s in tests
      .mockImplementation(((cb: (...args: unknown[]) => void) => {
        if (typeof cb === "function") cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout);

    fetchSpy
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "1" } })
      )
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: 1, modified_at: "2026-05-21T00:00:00.000Z" }] })
      );

    const client = PabauClient.from(linkWithApiToken());
    const seen: unknown[] = [];
    for await (const p of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      seen.push(p);
    }
    expect(seen).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    sleepSpy.mockRestore();
  });

  it("throws with the upstream body when GET fails non-429", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("forbidden", { status: 403 })
    );
    const client = PabauClient.from(linkWithApiToken());
    await expect(async () => {
      for await (const _p of client.streamPatients(
        "1970-01-01T00:00:00.000Z"
      )) {
        void _p;
      }
    }).rejects.toThrow(/403/);
  });
});

describe("PabauClient.healthCheck", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("uses /me when available", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ ok: true }));
    const client = PabauClient.from(linkWithApiToken());
    await expect(client.healthCheck()).resolves.toBeUndefined();
    expect((fetchSpy.mock.calls[0]![0] as string).endsWith("/me")).toBe(true);
  });

  it("falls back to /patients probe when /me returns 404", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(mockResponse({ data: [] }));
    const client = PabauClient.from(linkWithApiToken());
    await expect(client.healthCheck()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[1]![0] as string)).toContain("/patients?per_page=1");
  });

  it("throws when both /me and /patients fail", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const client = PabauClient.from(linkWithApiToken());
    await expect(client.healthCheck()).rejects.toThrow(/500/);
  });
});
