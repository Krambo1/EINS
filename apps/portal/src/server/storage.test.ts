import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDeletablePrefix, isPublicKey } from "./storage";

describe("public keys (L-11)", () => {
  it("only avatars may be served without a signature", () => {
    expect(isPublicKey("avatars/123.webp")).toBe(true);
    expect(isPublicKey("backups/portal-2026-10-08-abc.sql.gz")).toBe(false);
    expect(isPublicKey("c1/uploads/x.pdf")).toBe(false);
    expect(isPublicKey("c1/reports/2026-09.pdf")).toBe(false);
    expect(isPublicKey("pvs-csv-uploads/c1/x.csv")).toBe(false);
    expect(isPublicKey("avatars/../backups/x")).toBe(false);
  });
});

describe("prefix guard (L-12)", () => {
  it("accepts clinic folders", () => {
    expect(() => assertDeletablePrefix("4b1f0b5e-0000-4000-8000-000000000000/")).not.toThrow();
    expect(() => assertDeletablePrefix("pvs-csv-uploads/4b1f0b5e-0000-4000-8000-000000000000/")).not.toThrow();
  });
  it("rejects empty, root, relative or unterminated prefixes", () => {
    for (const p of ["", "/", "a/", "//", "abcdefgh", "x/../y/", "/abcdefgh/", "abc//defgh/"]) {
      expect(() => assertDeletablePrefix(p), p).toThrow();
    }
  });
});

describe("LocalStorage.removePrefix", () => {
  let dir: string;
  let cwd: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eins-storage-"));
    cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterEach(async () => {
    cwd.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  it("deletes everything under the folder and nothing next to it", async () => {
    const clinic = "4b1f0b5e-0000-4000-8000-000000000000";
    await mkdir(join(dir, "storage", clinic, "uploads"), { recursive: true });
    await mkdir(join(dir, "storage", clinic, "checklist", "A1"), { recursive: true });
    await mkdir(join(dir, "storage", "other-clinic"), { recursive: true });
    await writeFile(join(dir, "storage", clinic, "uploads", "a.jpg"), "x");
    await writeFile(join(dir, "storage", clinic, "checklist", "A1", "b.pdf"), "x");
    await writeFile(join(dir, "storage", "other-clinic", "c.pdf"), "x");

    vi.resetModules();
    const { getStorage } = await import("./storage");
    const out = await getStorage().removePrefix(`${clinic}/`);
    expect(out).toEqual({ removed: 2, failed: 0 });
    expect(await readdir(join(dir, "storage"))).toEqual(["other-clinic"]);
    // Second run: nothing left, still fine.
    expect(await getStorage().removePrefix(`${clinic}/`)).toEqual({ removed: 0, failed: 0 });
  });
});
