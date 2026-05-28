import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3-4: outbox-key lifecycle tests.
 *
 * The contract under test is small and high-stakes:
 *
 *   1. First boot generates a fresh 256-bit key and persists it via
 *      secure-store. Subsequent boots return the same key.
 *   2. A malformed key in secure-store fails LOUD; we never silently
 *      regenerate (that would orphan rows encrypted with the previous
 *      key and silently lose data).
 *   3. The generated key passes the validator (round-trip safety).
 */

const storeCalls: string[] = [];
let storedValue: string | null = null;

vi.mock("./secure-store.js", () => ({
  loadOutboxMasterKey: vi.fn(async () => storedValue),
  storeOutboxMasterKey: vi.fn(async (s: string) => {
    storeCalls.push(s);
    storedValue = s;
  }),
}));

let outboxKey: typeof import("./outbox-key");

beforeEach(async () => {
  storeCalls.length = 0;
  storedValue = null;
  vi.resetModules();
  outboxKey = await import("./outbox-key.js");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getOrCreateOutboxKey (P3-4)", () => {
  it("generates a fresh 64-char hex key on first boot and stores it", async () => {
    const key = await outboxKey.getOrCreateOutboxKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(storeCalls).toEqual([key]);
    // The generated key passes the validator we use on the load path.
    expect(outboxKey.isValidKeyHex(key)).toBe(true);
  });

  it("returns the stored key on subsequent boots without re-minting", async () => {
    const k1 = await outboxKey.getOrCreateOutboxKey();
    // Re-import to simulate a process restart; mock state persists.
    vi.resetModules();
    outboxKey = await import("./outbox-key.js");
    const k2 = await outboxKey.getOrCreateOutboxKey();
    expect(k2).toBe(k1);
    // Exactly one store call; the first-boot mint. The second boot's
    // load path returns the existing key and writes nothing.
    expect(storeCalls).toEqual([k1]);
  });

  it("generates entropy-distinct keys across separate first-boots", async () => {
    const a = await outboxKey.getOrCreateOutboxKey();

    // Reset persistent storage so the next call hits the mint path again.
    storedValue = null;
    storeCalls.length = 0;
    vi.resetModules();
    outboxKey = await import("./outbox-key.js");

    const b = await outboxKey.getOrCreateOutboxKey();
    expect(a).not.toBe(b);
    // Sanity: 64-char hex space is 2^256; collisions in test are
    // effectively impossible. If this ever fires, randomBytes is broken.
  });

  it("throws on a malformed stored key (wrong length)", async () => {
    storedValue = "deadbeef"; // 8 chars, far short of 64
    await expect(outboxKey.getOrCreateOutboxKey()).rejects.toThrow(
      /malformed/i
    );
    // We MUST NOT silently regenerate; that would orphan whatever rows
    // were encrypted with the original key.
    expect(storeCalls).toEqual([]);
  });

  it("throws on a stored key with non-hex characters", async () => {
    storedValue = "z".repeat(64);
    await expect(outboxKey.getOrCreateOutboxKey()).rejects.toThrow(
      /malformed/i
    );
    expect(storeCalls).toEqual([]);
  });

  it("throws on uppercase-hex (we canonicalise to lowercase)", async () => {
    storedValue = "A".repeat(64);
    await expect(outboxKey.getOrCreateOutboxKey()).rejects.toThrow(
      /malformed/i
    );
  });
});

describe("isValidKeyHex (P3-4)", () => {
  it("accepts 64-char lowercase hex", () => {
    expect(outboxKey.isValidKeyHex("0".repeat(64))).toBe(true);
    expect(outboxKey.isValidKeyHex("abcdef0123456789".repeat(4))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(outboxKey.isValidKeyHex("")).toBe(false);
    expect(outboxKey.isValidKeyHex("a".repeat(63))).toBe(false);
    expect(outboxKey.isValidKeyHex("a".repeat(65))).toBe(false);
  });

  it("rejects non-hex chars", () => {
    expect(outboxKey.isValidKeyHex("g".repeat(64))).toBe(false);
    expect(outboxKey.isValidKeyHex("z".repeat(64))).toBe(false);
  });

  it("rejects uppercase hex (canonical form is lowercase)", () => {
    expect(outboxKey.isValidKeyHex("A".repeat(64))).toBe(false);
  });
});
