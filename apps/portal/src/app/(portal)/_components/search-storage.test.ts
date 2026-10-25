import { afterEach, describe, expect, it } from "vitest";
import { clearSearchStorage } from "./search-storage";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("search-storage (L-1)", () => {
  it("clears every palette key but nothing else", () => {
    const ls = fakeStorage();
    (globalThis as { window?: unknown }).window = { localStorage: ls };
    ls.setItem("eins-portal-search-recent", "[]");
    ls.setItem("eins-portal-theme", "dark");
    clearSearchStorage();
    expect(ls.keys()).toEqual(["eins-portal-theme"]);
  });
});
