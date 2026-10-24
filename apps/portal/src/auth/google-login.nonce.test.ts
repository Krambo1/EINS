import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B-16: the Google id_token must carry the nonce derived from this browser's
 * signed state; an id_token minted for another login attempt is rejected.
 * Signature / issuer / audience checks are jose's job and mocked here.
 */
const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, jwtVerify: jwtVerifyMock, createRemoteJWKSet: () => ({}) };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import {
  buildGoogleAuthorizeUrl,
  exchangeCodeForGoogleEmail,
  oidcNonceForState,
} from "./google-login";

beforeEach(() => {
  jwtVerifyMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id_token: "header.payload.sig" }), { status: 200 }))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Google OIDC nonce", () => {
  it("is derived from the state and differs per state", () => {
    expect(oidcNonceForState("state-a")).toBe(oidcNonceForState("state-a"));
    expect(oidcNonceForState("state-a")).not.toBe(oidcNonceForState("state-b"));
    expect(oidcNonceForState("state-a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sent in the authorize request", () => {
    const url = new URL(buildGoogleAuthorizeUrl({ redirectUri: "http://localhost/cb", state: "state-a" }));
    expect(url.searchParams.get("nonce")).toBe(oidcNonceForState("state-a"));
    expect(url.searchParams.get("state")).toBe("state-a");
  });

  it("accepts an id_token with the matching nonce", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { nonce: oidcNonceForState("state-a"), email: "Dr@Praxis.de", email_verified: true },
    });
    await expect(
      exchangeCodeForGoogleEmail({ code: "c", redirectUri: "http://localhost/cb", state: "state-a" })
    ).resolves.toEqual({ email: "dr@praxis.de", emailVerified: true });
  });

  it("rejects an id_token from another login attempt or without nonce", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { nonce: oidcNonceForState("state-b"), email: "dr@praxis.de", email_verified: true },
    });
    await expect(
      exchangeCodeForGoogleEmail({ code: "c", redirectUri: "http://localhost/cb", state: "state-a" })
    ).rejects.toThrow(/nonce/);

    jwtVerifyMock.mockResolvedValueOnce({ payload: { email: "dr@praxis.de", email_verified: true } });
    await expect(
      exchangeCodeForGoogleEmail({ code: "c", redirectUri: "http://localhost/cb", state: "state-a" })
    ).rejects.toThrow(/nonce/);
  });
});
