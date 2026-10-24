import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * writeAtomic must never destroy the good file. Windows refuses a rename over an
 * existing file while an AV scanner holds it; the old code then DELETED the
 * target before the second rename, so a second failure lost both copies. The
 * rename is intercepted here to reproduce exactly that.
 */
const control = { failTmpRenames: 0 };

vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (String(from).includes(".tmp-") && control.failTmpRenames > 0) {
        control.failTmpRenames -= 1;
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      }
      return real.rename(from, to);
    },
  };
});

import {
  applyConfig,
  readActiveConfig,
  updateActiveMeta,
  type RemoteConfigMeta,
} from "./remote-config-store.js";

let root: string;
const saved: Record<string, string | undefined> = {};

function meta(version: number, notes: string): RemoteConfigMeta {
  return {
    vendor: "test-db",
    version,
    sha256: "x",
    keyId: "k",
    signature: "s",
    signedAt: 1,
    minAgentVersion: "0.3.0",
    notes,
    appliedAt: 1,
    preApplyStatuses: [],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eins-store-"));
  saved.EINS_AGENT_DATA_DIR = process.env.EINS_AGENT_DATA_DIR;
  process.env.EINS_AGENT_DATA_DIR = root;
  control.failTmpRenames = 0;
});

afterEach(() => {
  if (saved.EINS_AGENT_DATA_DIR === undefined) delete process.env.EINS_AGENT_DATA_DIR;
  else process.env.EINS_AGENT_DATA_DIR = saved.EINS_AGENT_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("remote-config-store writeAtomic", () => {
  it("keeps the good file when every rename of the new content fails", async () => {
    await applyConfig("test-db", "vendor: test-db\n", meta(1, "good"));
    control.failTmpRenames = 2; // direct rename AND the retry after moving aside
    await expect(updateActiveMeta("test-db", meta(1, "new"))).rejects.toThrow();
    control.failTmpRenames = 0;
    const stored = await readActiveConfig("test-db");
    expect(stored?.meta.notes).toBe("good");
  });

  it("replaces the file when only the first rename is refused", async () => {
    await applyConfig("test-db", "vendor: test-db\n", meta(1, "old"));
    control.failTmpRenames = 1;
    await updateActiveMeta("test-db", meta(1, "new"));
    const stored = await readActiveConfig("test-db");
    expect(stored?.meta.notes).toBe("new");
  });
});
