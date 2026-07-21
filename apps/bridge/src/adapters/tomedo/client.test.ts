import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TomedoClient } from "./client.js";
import type { PvsLinkRow } from "../../db/client.js";

/**
 * Tomedo HTTP client: OAuth token minting, offset pagination, and the H17
 * termination contract (stop on an EMPTY page, advance offset by the number
 * of rows actually returned so a server-side limit clamp cannot skip rows).
 */

const CLINIC = "00000000-0000-0000-0000-000000000003";

function link(): PvsLinkRow {
  return {
    id: "link-3",
    clinicId: CLINIC,
    pvsVendor: "tomedo",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: {
      tomedoEndpoint: "https://tenant-foo.tomedo.de/api/v1",
      tomedoClientId: "cid",
      tomedoClientSecret: "csecret",
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: "tok", expires_in: 3600 });
}

describe("TomedoClient pagination (H17)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("collects ALL rows when the server clamps the page size, terminating on the empty page", async () => {
    // Requested limit=500 but the server clamps to 100. Old code stopped
    // after page 1 (100 < 500) and dropped rows 100..199.
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        modifiedAt: "2026-05-21T00:00:00.000Z",
        id: start + i,
      }));

    fetchSpy
      .mockResolvedValueOnce(tokenResponse()) // ensureToken (first call)
      .mockResolvedValueOnce(jsonResponse({ items: page(0, 100), total: 200 }))
      .mockResolvedValueOnce(jsonResponse({ items: page(100, 100), total: 200 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 200 }));

    const client = TomedoClient.from(link());
    const seen: unknown[] = [];
    for await (const r of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      seen.push(r);
    }
    expect(seen).toHaveLength(200);

    // Offset must advance by the rows actually returned (100), not the
    // requested PAGE_SIZE (500): page 2 must request offset=100.
    const dataCalls = fetchSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => u.includes("/patients"));
    expect(dataCalls[0]).toContain("offset=0");
    expect(dataCalls[0]).toContain("limit=500");
    expect(dataCalls[1]).toContain("offset=100");
    expect(dataCalls[2]).toContain("offset=200");
  });

  it("throws on a 200 whose body lacks the items array (error envelope, not empty page) (M-S2)", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({ error: "token_scope_insufficient" })
      );
    const client = TomedoClient.from(link());
    await expect(async () => {
      for await (const _r of client.streamPatients("1970-01-01T00:00:00.000Z")) {
        void _r;
      }
    }).rejects.toThrow(/missing 'items' array/);
  });

  it("gives up after MAX_RETRIES consecutive 429s instead of hot-looping (M-S1)", async () => {
    const sleepSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((cb: (...args: unknown[]) => void) => {
        if (typeof cb === "function") cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout);
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      // An HTTP-date Retry-After (Number(date) would be NaN in the old code) on
      // an endpoint that never clears its 429: must terminate via the cap.
      .mockResolvedValue(
        new Response("", {
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
        })
      );
    const client = TomedoClient.from(link());
    await expect(async () => {
      for await (const _r of client.streamPatients("1970-01-01T00:00:00.000Z")) {
        void _r;
      }
    }).rejects.toThrow(/exceeded \d+ retries/);
    sleepSpy.mockRestore();
  });

  it("attaches an AbortSignal to every request (H15)", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    const client = TomedoClient.from(link());
    for await (const _r of client.streamPatients("1970-01-01T00:00:00.000Z")) {
      void _r;
    }
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
