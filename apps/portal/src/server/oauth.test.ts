import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("@/lib/crypto", () => ({ deriveSigningKey: () => new TextEncoder().encode("k".repeat(32)) }));

import { parseReturnTo, signState, verifyState } from "./oauth";

const BASE = { clinicId: "clinic-1", userId: "user-1", platform: "meta" as const, nonce: "n" };

describe("OAuth return page", () => {
  it("accepts only the listed pages", () => {
    expect(parseReturnTo("/werbebudget")).toBe("/werbebudget");
    for (const v of ["https://evil.test", "//evil.test", "/werbebudget/../admin", "/einstellungen", "", null, 3]) {
      expect(parseReturnTo(v)).toBeUndefined();
    }
  });

  it("survives the signed state, and an unlisted one is dropped", async () => {
    expect((await verifyState(await signState({ ...BASE, returnTo: "/werbebudget" })))?.returnTo).toBe("/werbebudget");
    const forged = await signState({ ...BASE, returnTo: "//evil.test" as never });
    expect((await verifyState(forged))?.returnTo).toBeUndefined();
  });
});
