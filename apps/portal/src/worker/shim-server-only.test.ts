import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Importing the shim runs its side effect once: pre-populate the CommonJS
// require cache for `server-only` with an empty exports object. Worker entry
// points do this first so any transitively server-only module (db/client,
// storage, monthly-pdf, ...) can be imported under tsx/Node without tripping
// the package's `throw`. See src/worker/shim-server-only.ts.
import "./shim-server-only";

/**
 * Regression guard for the tsx-worker `server-only` crash.
 *
 * `server-only`'s package body is `throw new Error(...)`; Next.js swaps it for
 * an empty module via the `react-server` export condition at build time, but
 * plain Node/tsx (how `pnpm worker` / `pnpm cron` run) does not set that
 * condition, so the throw fires. The worker neutralizes it with a require-cache
 * shim loaded as the very first import.
 *
 * These tests reach the REAL `server-only` package via `createRequire` on
 * purpose. vitest.config.ts aliases `server-only` to a noop for the whole test
 * module graph, so importing a server-only module through vitest would pass
 * even if the shim were deleted. `createRequire` uses Node's own resolver and
 * the process-global `Module._cache` (the same cache the shim populates), so it
 * exercises the actual runtime mechanism the worker depends on.
 */
const req = createRequire(import.meta.url);
const serverOnlyFile = req.resolve("server-only");

describe("server-only worker shim", () => {
  it("the real server-only package throws when evaluated without the shim", () => {
    // Force a fresh evaluation by dropping the shim's cache entry, then prove
    // the package really does throw. Restore the entry afterwards so the
    // worker invariant (and the next test) still holds — Node does not re-cache
    // a module whose evaluation threw.
    const cached = req.cache[serverOnlyFile];
    delete req.cache[serverOnlyFile];
    try {
      expect(() => req("server-only")).toThrow(/Client Component/);
    } finally {
      req.cache[serverOnlyFile] = cached;
    }
  });

  it("the shim pre-populates the require cache so server-only is a noop", () => {
    // If shim-server-only.ts ever stops populating the cache (removed, broken,
    // or defeated by a tsx/Node change), this fails.
    expect(req.cache[serverOnlyFile]).toBeTruthy();
    expect(() => req("server-only")).not.toThrow();
    expect(req("server-only")).toEqual({});
  });

  it.each(["index.ts", "cron.ts"])(
    "worker entry %s imports the shim before any other statement",
    (entry) => {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(path.join(dir, entry), "utf8");
      const firstStatement = src
        .split("\n")
        .map((line) => line.trim())
        .find(
          (line) =>
            line.length > 0 &&
            !line.startsWith("//") &&
            !line.startsWith("/*") &&
            !line.startsWith("*")
        );
      // Must be the shim, so it runs before any transitively server-only
      // module is evaluated at worker startup.
      expect(firstStatement).toMatch(/^import\s+["']\.\/shim-server-only["']/);
    }
  );
});
