import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/**
 * M-S4 contract, pinned against the db/client.ts source in the same style as
 * the loadDueLinks SQL-contract test in client.test.ts (a pg-mem integration
 * harness isn't worth the dep weight for these one-line SQL invariants):
 *
 *   1. Failure backoff off-by-one: the DO UPDATE must schedule next_poll_at off
 *      the POST-increment count (`+ 1`), so the first failure waits a full
 *      backoff step instead of retrying immediately (0 * 60s).
 *   2. Error links self-recover: once a link crosses FAIL_THRESHOLD it backs off
 *      to an hourly cadence, and loadDueLinks selects status='error' links so
 *      they are retried instead of being permanently dead.
 *   3. Recovery restores status: a successful poll / initial sync clears the
 *      'error' status (clearErrorStatus), and both transitions are logged.
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

describe("recordFailure backoff (M-S4)", () => {
  const body = slice("recordFailure");

  it("schedules the next poll off the post-increment failure count (off-by-one fix)", () => {
    expect(body).toMatch(/consecutive_failure_count \+ 1/);
    // The old bug used the bare pre-increment count inside the LEAST(...) math.
    expect(body).toMatch(/LEAST\(pvs_sync_status\.consecutive_failure_count \+ 1/);
  });

  it("backs an errored link off to an hourly recovery cadence", () => {
    expect(body).toMatch(/INTERVAL '1 hour'/);
    expect(body).toMatch(/>=\s*\$\{failThreshold\}/);
  });

  it("only trips to error on the actual transition and logs loudly", () => {
    expect(body).toMatch(/status <> 'error'/);
    expect(body).toMatch(/entered status=error/);
  });
});

describe("self-recovery wiring (M-S4)", () => {
  it("loadDueLinks selects status='error' links for retry", () => {
    const body = slice("loadDueLinks");
    expect(body).toMatch(/l\.status = 'error'/);
    // The existing 'connected' gate must stay intact.
    expect(body).toMatch(/l\.status = 'connected'/);
  });

  it("clearErrorStatus restores 'connected' and logs the recovery", () => {
    const body = slice("clearErrorStatus");
    expect(body).toMatch(/status = 'connected'/);
    expect(body).toMatch(/status = 'error'/);
    expect(body).toMatch(/recovered from status=error/);
  });

  it("both success paths clear a self-recovered error status", () => {
    expect(slice("checkpointSync")).toMatch(/clearErrorStatus\(linkId\)/);
    expect(slice("completeInitialSync")).toMatch(/clearErrorStatus\(linkId\)/);
  });
});
