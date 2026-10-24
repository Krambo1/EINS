import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/**
 * Failure-state contract, pinned against the db/client.ts source (a pg-mem
 * harness isn't worth the dep weight for these one-line SQL invariants):
 *
 *   1. Backoff off-by-one stays fixed: next_poll_at is scheduled off the
 *      POST-increment count (`+ 1`).
 *   2. The bridge NEVER writes pvs_link.status='error' any more: the portal
 *      rejects every event for an 'error' link, so tripping it froze the
 *      practice for good. Failure state lives in pvs_sync_status (last_error,
 *      consecutive_failure_count) and /healthz. Past FAIL_THRESHOLD the link
 *      settles at a 15 minute cadence and keeps being retried.
 *   3. Legacy links already tripped to 'error' are still loaded and are
 *      un-tripped on claim (restoreLegacyErrorStatus).
 *   4. claimLink is an atomic lease on next_poll_at (mutual exclusion).
 */

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, "client.ts"), "utf8");

function slice(fnName: string): string {
  const declRe = new RegExp(`(?:export )?(?:async )?function ${fnName}\\b`);
  const m = declRe.exec(SOURCE);
  expect(m).not.toBeNull();
  const after = SOURCE.slice(m!.index + m![0].length);
  // Next top-level declaration (at line start) bounds this function's body.
  const nextRe = /\n(?:export )?(?:async )?function /;
  const nm = nextRe.exec(after);
  return nm ? after.slice(0, nm.index) : after;
}

describe("recordFailure backoff", () => {
  const body = slice("recordFailure").split(String.fromCharCode(10) + "}" + String.fromCharCode(10))[0]!;

  it("schedules the next poll off the post-increment failure count (off-by-one fix)", () => {
    expect(body).toMatch(/LEAST\(pvs_sync_status\.consecutive_failure_count \+ 1/);
  });

  it("settles at 15 minutes once past the threshold, with retryAfter as a floor", () => {
    expect(body).toMatch(/INTERVAL '15 minutes'/);
    expect(body).toMatch(/>=\s*\$\{failThreshold\}/);
    expect(body).toMatch(/GREATEST\(/);
  });

  it("never writes pvs_link (no status='error' trip)", () => {
    expect(body).not.toMatch(/UPDATE pvs_link/);
    expect(body).not.toMatch(/status\s*=\s*'error'/);
  });
});

describe("legacy error links and claim lease", () => {
  it("loadDueLinks still selects legacy status='error' links alongside 'connected'", () => {
    const body = slice("loadDueLinks");
    expect(body).toMatch(/l\.status = 'error'/);
    expect(body).toMatch(/l\.status = 'connected'/);
  });

  it("restoreLegacyErrorStatus only flips error back to connected", () => {
    const body = slice("restoreLegacyErrorStatus");
    expect(body).toMatch(/status = 'connected'/);
    expect(body).toMatch(/status = 'error'/);
    expect(body).toMatch(/un-tripped/);
  });

  it("claimLink is one atomic conditional upsert on next_poll_at", () => {
    const body = slice("claimLink");
    expect(body).toMatch(/ON CONFLICT \(pvs_link_id\) DO UPDATE/);
    expect(body).toMatch(/next_poll_at <= NOW\(\)/);
    expect(body).toMatch(/RETURNING/);
  });
});
