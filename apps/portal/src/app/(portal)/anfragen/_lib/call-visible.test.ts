import { describe, expect, it } from "vitest";
import { hiddenKeys, visibleCalls, type LogEntry } from "./call-visible";

const order = ["a-1", "a-2", "w-3", "a-4", "a-5", "a-6"];
const none = new Set<string>();

describe("visibleCalls", () => {
  it("shows the first call as hero and the next five as rows", () => {
    expect(visibleCalls(order, none, 5, 6)).toEqual({
      hero: "a-1",
      rows: ["a-2", "w-3", "a-4", "a-5", "a-6"],
      moreMayExist: true,
    });
  });

  it("moves the next patient up when the hero is logged", () => {
    const v = visibleCalls(order, new Set(["a-1"]), 5, 6);
    expect(v.hero).toBe("a-2");
    expect(v.rows).toEqual(["w-3", "a-4", "a-5", "a-6"]);
  });

  it("handles a second call logged while the first save runs", () => {
    const v = visibleCalls(order, new Set(["a-1", "a-2"]), 5, 6);
    expect(v.hero).toBe("w-3");
    expect(v.rows).toEqual(["a-4", "a-5", "a-6"]);
  });

  it("hides a call from the middle of the queue too", () => {
    const v = visibleCalls(order, new Set(["a-3", "w-3"]), 5, 6);
    expect(v.hero).toBe("a-1");
    expect(v.rows).toEqual(["a-2", "a-4", "a-5", "a-6"]);
  });

  it("has no hero once everything is logged, and says if more may follow", () => {
    const all = new Set(order);
    expect(visibleCalls(order, all, 5, 6)).toEqual({ hero: null, rows: [], moreMayExist: true });
    const few = ["a-1", "a-2"];
    expect(visibleCalls(few, new Set(few), 5, 6)).toEqual({ hero: null, rows: [], moreMayExist: false });
  });

  it("never shows more rows than there are slots", () => {
    const long = Array.from({ length: 12 }, (_, i) => `a-${i}`);
    expect(visibleCalls(long, none, 5, 6).rows).toHaveLength(5);
  });

  it("shows nothing for an empty queue", () => {
    expect(visibleCalls([], none, 5, 6)).toEqual({ hero: null, rows: [], moreMayExist: false });
  });
});

describe("visibleCalls, failed save while another patient is on the card", () => {
  it("keeps the current hero and puts the failed patient on the first row", () => {
    // a-1 failed, the user is on a-2 (a-1 itself is no longer hidden).
    const v = visibleCalls(order, new Set(), 5, 6, { behind: ["a-1"] });
    expect(v.hero).toBe("a-2");
    expect(v.rows).toEqual(["a-1", "w-3", "a-4", "a-5", "a-6"]);
  });

  it("keeps five rows when the failed patient comes back", () => {
    const long = Array.from({ length: 8 }, (_, i) => `a-${i}`);
    const v = visibleCalls(long, new Set(["a-1"]), 5, 8, { behind: ["a-0"] });
    expect(v.hero).toBe("a-2");
    expect(v.rows).toEqual(["a-0", "a-3", "a-4", "a-5", "a-6"]);
  });

  it("puts the newest failure first", () => {
    const v = visibleCalls(order, new Set(["a-3"]), 5, 6, { behind: ["a-1", "a-2"] });
    expect(v.hero).toBe("w-3");
    expect(v.rows).toEqual(["a-2", "a-1", "a-4", "a-5", "a-6"]);
  });

  it("makes the failed patient the hero when nobody else is left", () => {
    const v = visibleCalls(["a-1"], new Set(), 5, 6, { behind: ["a-1"] });
    expect(v.hero).toBe("a-1");
    expect(v.rows).toEqual([]);
  });

  it("ignores a failed patient who is being saved again", () => {
    const v = visibleCalls(order, new Set(["a-1"]), 5, 6, { behind: ["a-1"] });
    expect(v.hero).toBe("a-2");
    expect(v.rows).toEqual(["w-3", "a-4", "a-5", "a-6"]);
  });
});

describe("visibleCalls, forced Wiederbehandlung", () => {
  const six = ["a-1", "a-2", "a-3", "a-4", "a-5", "w-9", "a-7", "a-8"];

  it("is in the last row from the start", () => {
    const v = visibleCalls(six, new Set(), 5, 8, { pinned: "w-9" });
    expect(v.hero).toBe("a-1");
    expect(v.rows).toEqual(["a-2", "a-3", "a-4", "a-5", "w-9"]);
  });

  it("stays in the last row when a call leaves, the reserve fills in before it", () => {
    const v = visibleCalls(six, new Set(["a-1"]), 5, 8, { pinned: "w-9" });
    expect(v.hero).toBe("a-2");
    expect(v.rows).toEqual(["a-3", "a-4", "a-5", "a-7", "w-9"]);
  });

  it("moves up only when the reserve is used up", () => {
    const v = visibleCalls(six, new Set(["a-1", "a-2", "a-3", "a-4", "a-5", "a-7"]), 5, 8, { pinned: "w-9" });
    expect(v.hero).toBe("a-8");
    expect(v.rows).toEqual(["w-9"]);
  });

  it("is hero when it is all that is left, and gone once logged", () => {
    expect(visibleCalls(["w-9"], new Set(), 5, 8, { pinned: "w-9" }).hero).toBe("w-9");
    expect(visibleCalls(["a-1", "w-9"], new Set(["w-9"]), 5, 8, { pinned: "w-9" }).rows).toEqual([]);
  });
});

describe("hiddenKeys", () => {
  const entries: LogEntry[] = [
    { key: "a-1", id: 1 },
    { key: "a-2", id: 2 },
  ];

  it("hides every call being saved", () => {
    expect([...hiddenKeys(entries, new Set())]).toEqual(["a-1", "a-2"]);
  });

  it("brings back only the patient whose save failed", () => {
    expect([...hiddenKeys(entries, new Set([1]))]).toEqual(["a-2"]);
  });

  it("keeps a patient hidden when a second try of the same call is running", () => {
    const retry: LogEntry[] = [...entries, { key: "a-1", id: 3 }];
    expect([...hiddenKeys(retry, new Set([1]))].sort()).toEqual(["a-1", "a-2"]);
  });

  it("puts the failed patient back on the card", () => {
    const order = ["a-1", "a-2", "a-3"];
    // Both logged, the first one failed: it is the hero again, the second stays gone.
    const v = visibleCalls(order, hiddenKeys(entries, new Set([1])), 5, 6);
    expect(v.hero).toBe("a-1");
    expect(v.rows).toEqual(["a-3"]);
    const both = visibleCalls(order, hiddenKeys(entries, new Set([1, 2])), 5, 6);
    expect(both.hero).toBe("a-1");
    expect(both.rows).toEqual(["a-2", "a-3"]);
  });
});
