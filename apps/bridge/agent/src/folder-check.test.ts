import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMissingFolders } from "./folder-check.js";

describe("findMissingFolders (H13.1)", () => {
  it("reports a configured folder that does not exist on disk", async () => {
    const real = mkdtempSync(join(tmpdir(), "eins-folder-test-"));
    const bogus = join(real, "does-not-exist");
    try {
      const missing = await findMissingFolders([real, bogus]);
      expect(missing).toEqual([bogus]);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("returns empty when every folder exists", async () => {
    const real = mkdtempSync(join(tmpdir(), "eins-folder-test-"));
    try {
      expect(await findMissingFolders([real])).toEqual([]);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("skips empty / falsy entries and uses the injected stat", async () => {
    const calls: string[] = [];
    const statFn = async (p: string) => {
      calls.push(p);
      if (p === "/missing") throw new Error("ENOENT");
      return {};
    };
    const missing = await findMissingFolders(
      ["/present", "", "/missing"],
      statFn
    );
    expect(missing).toEqual(["/missing"]);
    expect(calls).toEqual(["/present", "/missing"]); // "" skipped
  });
});
