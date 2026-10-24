import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OutboxKeyError,
  getOrCreateOutboxKey,
  isValidKeyHex,
  outboxFileHasData,
  type OutboxKeyDeps,
} from "./outbox-key.js";
import type { SecretLoad } from "./secure-store.js";

/**
 * P3-4 outbox-key lifecycle, with the "never mint over an existing outbox"
 * rule that the field defect (new key + old outbox = "file is not a database")
 * broke.
 *
 * The contract under test is small and high-stakes:
 *
 *   1. First boot (no key, no outbox) generates a fresh 256-bit key, persists
 *      it, reads it back and returns the persisted value.
 *   2. A malformed key fails LOUD; we never silently regenerate.
 *   3. A key that EXISTS but cannot be read (status "error") never causes a
 *      mint, and never causes a store (which would overwrite the real key).
 *   4. A missing key while outbox.sqlite already holds data never mints.
 */

interface Harness {
  deps: OutboxKeyDeps;
  stored: { value: string | null };
  storeCalls: string[];
  mintCalls: { n: number };
  setLoad: (fn: () => SecretLoad) => void;
}

function harness(opts: {
  initial?: SecretLoad;
  outboxExists?: boolean;
  minted?: string;
}): Harness {
  const stored: { value: string | null } = { value: null };
  const storeCalls: string[] = [];
  const mintCalls = { n: 0 };
  let loader: () => SecretLoad = () =>
    stored.value === null ? { status: "absent" } : { status: "ok", value: stored.value };
  if (opts.initial) {
    const initial = opts.initial;
    if (initial.status === "ok") stored.value = initial.value;
    else if (initial.status === "error") loader = () => initial;
  }
  const deps: OutboxKeyDeps = {
    load: async () => loader(),
    store: async (k) => {
      storeCalls.push(k);
      stored.value = k;
    },
    outboxExists: () => opts.outboxExists ?? false,
    outboxFile: () => "C:\\ProgramData\\EINS-Agent\\outbox.sqlite",
    mint: () => {
      mintCalls.n += 1;
      return opts.minted ?? "ab".repeat(32);
    },
  };
  return { deps, stored, storeCalls, mintCalls, setLoad: (fn) => (loader = fn) };
}

describe("getOrCreateOutboxKey (P3-4)", () => {
  it("generates a fresh 64-char hex key on first boot and stores it", async () => {
    const h = harness({});
    const key = await getOrCreateOutboxKey(h.deps);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(h.storeCalls).toEqual([key]);
    expect(isValidKeyHex(key)).toBe(true);
  });

  it("returns the stored key on subsequent boots without re-minting or re-storing", async () => {
    const h = harness({});
    const k1 = await getOrCreateOutboxKey(h.deps);
    const k2 = await getOrCreateOutboxKey(h.deps);
    expect(k2).toBe(k1);
    expect(h.storeCalls).toEqual([k1]);
    expect(h.mintCalls.n).toBe(1);
  });

  it("returns an existing key even when an outbox exists (the normal restart)", async () => {
    const existing = "0f".repeat(32);
    const h = harness({ initial: { status: "ok", value: existing }, outboxExists: true });
    expect(await getOrCreateOutboxKey(h.deps)).toBe(existing);
    expect(h.mintCalls.n).toBe(0);
    expect(h.storeCalls).toEqual([]);
  });

  it("throws on a malformed stored key (wrong length) and never regenerates", async () => {
    const h = harness({ initial: { status: "ok", value: "deadbeef" } });
    await expect(getOrCreateOutboxKey(h.deps)).rejects.toThrow(/malformed/i);
    expect(h.storeCalls).toEqual([]);
    expect(h.mintCalls.n).toBe(0);
  });

  it("throws on a stored key with non-hex characters", async () => {
    const h = harness({ initial: { status: "ok", value: "z".repeat(64) } });
    await expect(getOrCreateOutboxKey(h.deps)).rejects.toThrow(/malformed/i);
    expect(h.storeCalls).toEqual([]);
  });

  it("throws on uppercase hex (we canonicalise to lowercase)", async () => {
    const h = harness({ initial: { status: "ok", value: "A".repeat(64) } });
    await expect(getOrCreateOutboxKey(h.deps)).rejects.toThrow(/malformed/i);
  });
});

describe("never mint over an existing outbox (field defect)", () => {
  it("key blob unreadable (DPAPI failure): throws KEY_UNREADABLE, mints and stores NOTHING", async () => {
    const h = harness({
      initial: { status: "error", reason: "DPAPI: Key not valid for use in specified state." },
      outboxExists: false, // even with no outbox: the blob exists, so it is not ours to replace
    });
    const err = await getOrCreateOutboxKey(h.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutboxKeyError);
    expect((err as OutboxKeyError).code).toBe("KEY_UNREADABLE");
    expect(h.mintCalls.n).toBe(0);
    expect(h.storeCalls).toEqual([]);
  });

  it("key blob unreadable and outbox present: same, with the reason and the outbox path in the message", async () => {
    const h = harness({
      initial: { status: "error", reason: "different user" },
      outboxExists: true,
    });
    const err = (await getOrCreateOutboxKey(h.deps).catch((e: unknown) => e)) as OutboxKeyError;
    expect(err.code).toBe("KEY_UNREADABLE");
    expect(err.message).toContain("different user");
    expect(err.message).toContain("outbox.sqlite");
    // German first, English second, and the "do not delete" instruction.
    expect(err.message).toMatch(/startet NICHT/);
    expect(err.message).toMatch(/DO NOT delete/);
    expect(h.mintCalls.n).toBe(0);
    expect(h.storeCalls).toEqual([]);
  });

  it("key absent but outbox.sqlite has data: throws KEY_MISSING_WITH_OUTBOX, mints and stores NOTHING", async () => {
    const h = harness({ initial: { status: "absent" }, outboxExists: true });
    const err = (await getOrCreateOutboxKey(h.deps).catch((e: unknown) => e)) as OutboxKeyError;
    expect(err).toBeInstanceOf(OutboxKeyError);
    expect(err.code).toBe("KEY_MISSING_WITH_OUTBOX");
    expect(h.mintCalls.n).toBe(0);
    expect(h.storeCalls).toEqual([]);
  });

  it("key absent, no outbox: mints exactly once (the only legitimate mint)", async () => {
    const h = harness({ initial: { status: "absent" }, outboxExists: false });
    const key = await getOrCreateOutboxKey(h.deps);
    expect(key).toBe("ab".repeat(32));
    expect(h.mintCalls.n).toBe(1);
    expect(h.storeCalls).toEqual([key]);
  });

  it("store 'succeeds' but the key cannot be read back: refuses (KEY_NOT_PERSISTED), no outbox is created with it", async () => {
    const h = harness({ initial: { status: "absent" } });
    h.deps.store = async (k) => void h.storeCalls.push(k); // stores nothing
    const err = (await getOrCreateOutboxKey(h.deps).catch((e: unknown) => e)) as OutboxKeyError;
    expect(err.code).toBe("KEY_NOT_PERSISTED");
  });

  it("read-back error after store: refuses (KEY_NOT_PERSISTED) with the reason", async () => {
    const h = harness({ initial: { status: "absent" } });
    let loads = 0;
    h.deps.load = async () => {
      loads += 1;
      return loads === 1 ? { status: "absent" } : { status: "error", reason: "locked keychain" };
    };
    const err = (await getOrCreateOutboxKey(h.deps).catch((e: unknown) => e)) as OutboxKeyError;
    expect(err.code).toBe("KEY_NOT_PERSISTED");
    expect(err.message).toContain("locked keychain");
  });

  it("adopts the persisted value when a racing process stored a different key first", async () => {
    const h = harness({ initial: { status: "absent" } });
    const winner = "11".repeat(32);
    let loads = 0;
    h.deps.load = async () => {
      loads += 1;
      return loads === 1 ? { status: "absent" } : { status: "ok", value: winner };
    };
    expect(await getOrCreateOutboxKey(h.deps)).toBe(winner);
  });

  it("read-back value that is malformed refuses to start", async () => {
    const h = harness({ initial: { status: "absent" } });
    let loads = 0;
    h.deps.load = async () => {
      loads += 1;
      return loads === 1 ? { status: "absent" } : { status: "ok", value: "nope" };
    };
    await expect(getOrCreateOutboxKey(h.deps)).rejects.toThrow(/malformed/i);
  });
});

describe("outboxFileHasData", () => {
  it("false when the file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "eins-outbox-key-"));
    try {
      expect(outboxFileHasData(join(dir, "outbox.sqlite"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("false for a zero-byte file (nothing queued in it), true once it has content", () => {
    const dir = mkdtempSync(join(tmpdir(), "eins-outbox-key-"));
    try {
      const f = join(dir, "outbox.sqlite");
      writeFileSync(f, "");
      expect(outboxFileHasData(f)).toBe(false);
      writeFileSync(f, "SQLite format 3\0");
      expect(outboxFileHasData(f)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("true (conservative) when stat fails for a reason other than ENOENT", () => {
    const denied = (): never => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    };
    expect(outboxFileHasData("C:\ProgramData\EINS-Agent\outbox.sqlite", denied)).toBe(true);
    const io = (): never => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    };
    expect(outboxFileHasData("/x/outbox.sqlite", io)).toBe(true);
    const gone = (): never => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(outboxFileHasData("/x/outbox.sqlite", gone)).toBe(false);
  });
});

describe("isValidKeyHex (P3-4)", () => {
  it("accepts 64-char lowercase hex", () => {
    expect(isValidKeyHex("0".repeat(64))).toBe(true);
    expect(isValidKeyHex("abcdef0123456789".repeat(4))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidKeyHex("")).toBe(false);
    expect(isValidKeyHex("a".repeat(63))).toBe(false);
    expect(isValidKeyHex("a".repeat(65))).toBe(false);
  });

  it("rejects non-hex chars", () => {
    expect(isValidKeyHex("g".repeat(64))).toBe(false);
    expect(isValidKeyHex("z".repeat(64))).toBe(false);
  });

  it("rejects uppercase hex (canonical form is lowercase)", () => {
    expect(isValidKeyHex("A".repeat(64))).toBe(false);
  });
});
