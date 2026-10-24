import { afterEach, describe, expect, it } from "vitest";
import { clearLegacySearchStorage, clearSearchStorage, searchStorageKeys } from "./search-storage";

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
  it("scopes keys per clinic and login, without the e-mail in the key", () => {
    const a = searchStorageKeys("clinic-a", "Empfang@Praxis.de");
    expect(a).toEqual(searchStorageKeys("clinic-a", "empfang@praxis.de"));
    expect(a.recent).not.toBe(searchStorageKeys("clinic-b", "empfang@praxis.de").recent);
    expect(a.recent).not.toBe(searchStorageKeys("clinic-a", "arzt@praxis.de").recent);
    expect(a.recent).not.toContain("praxis");
  });

  it("clears every palette key but nothing else", () => {
    const ls = fakeStorage();
    (globalThis as { window?: unknown }).window = { localStorage: ls };
    const k = searchStorageKeys("c", "u");
    ls.setItem(k.recent, "[]");
    ls.setItem(k.pinned, "[]");
    ls.setItem("eins-portal-search-recent", "[]");
    ls.setItem("eins-portal-theme", "dark");
    clearLegacySearchStorage();
    expect(ls.keys()).toEqual([k.recent, k.pinned, "eins-portal-theme"]);
    clearSearchStorage();
    expect(ls.keys()).toEqual(["eins-portal-theme"]);
  });
});
