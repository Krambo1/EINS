import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Staleness gate for the generated canonical mirror.
 *
 * generated-canonical.ts is GENERATED from apps/bridge/src/canonical/
 * schema-source.ts by apps/bridge/scripts/gen-canonical.mjs and committed (the
 * agent ships as a single binary with zero monorepo runtime deps, so it cannot
 * import the source at runtime). If someone edits the source and forgets to
 * regenerate, the committed mirror goes stale and the agent would emit/validate
 * against an out-of-date set. This test catches that.
 *
 * It spawns the generator with `node ... --print` (real Node, no bundler in the
 * loop, no cross-package import resolution) and byte-compares stdout against the
 * committed file. The repo pins these files to LF (apps/bridge/.gitattributes),
 * so the comparison is exact on every platform.
 */
const GENERATOR_PATH = fileURLToPath(
  new URL("../../../scripts/gen-canonical.mjs", import.meta.url)
);
const COMMITTED_PATH = fileURLToPath(
  new URL("./generated-canonical.ts", import.meta.url)
);
const REGEN_COMMAND = "node apps/bridge/scripts/gen-canonical.mjs";

describe("generated-canonical.ts", () => {
  it("is byte-identical to a fresh generation from schema-source.ts", () => {
    const fresh = execFileSync(process.execPath, [GENERATOR_PATH, "--print"], {
      encoding: "utf8",
    });
    const committed = readFileSync(COMMITTED_PATH, "utf8");
    expect(
      committed,
      `generated-canonical.ts is stale. Run \`${REGEN_COMMAND}\` and commit the result.`
    ).toBe(fresh);
  });
});
