import { afterEach, describe, expect, it, vi } from "vitest";
import { checkFolders } from "./folder-check.js";

/**
 * WP-C A11: an offline UNC share can make stat() hang for the OS network
 * timeout. The check ran before the flush and heartbeat timers were created,
 * so nothing uploaded and no heartbeat was sent until it returned.
 */

afterEach(() => vi.useRealTimers());

describe("checkFolders is bounded", () => {
  it("returns within ~10 s when stat never resolves and reports the folder unreachable", async () => {
    vi.useFakeTimers();
    const statFn = () => new Promise<never>(() => {});
    let done = false;
    const p = checkFolders(["\\\\offline\\share\\gdt", "\\\\offline\\share\\csv"], {
      statFn,
      platform: "linux",
    }).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true); // both folders were waited for in parallel, not 2 x 10 s
    const problems = await p;
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatchObject({ reason: "unreachable", code: "ETIMEDOUT" });
  });

  it("a fast folder is not delayed by a hanging one and order is preserved", async () => {
    vi.useFakeTimers();
    const statFn = (p: string) =>
      p === "/hang" ? new Promise<never>(() => {}) : Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" }));
    const pending = checkFolders(["/hang", "/gone"], { statFn, platform: "linux" });
    await vi.advanceTimersByTimeAsync(10_500);
    const problems = await pending;
    expect(problems.map((p) => [p.path, p.reason])).toEqual([
      ["/hang", "unreachable"],
      ["/gone", "missing"],
    ]);
  });

  it("does not leave a pending timer behind when stat answers", async () => {
    vi.useFakeTimers();
    await checkFolders(["/ok"], { statFn: async () => ({ isDirectory: () => true }), platform: "linux" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
