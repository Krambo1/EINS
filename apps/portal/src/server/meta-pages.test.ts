import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptString, encryptString } from "@/lib/crypto";
import {
  META_OAUTH_SCOPES,
  META_PAGES_FIXTURE,
  META_PAGE_ERRORS,
  chooseAndStoreMetaPage,
  chooseMetaPage,
  discoverAndStoreMetaPage,
  fetchMetaPageSummaries,
  fetchMetaPages,
  loadMetaPagePicker,
  metaPageChoiceErrorText,
  metaPageErrorText,
  releaseDisconnectedMetaPage,
  safeGraphNext,
  selectChosenMetaPage,
  type MetaBindingStore,
  type MetaPage,
} from "./meta-pages";

const page = (id: string) => ({ id, name: `Seite ${id}`, access_token: `t-${id}` });

describe("chooseMetaPage (J-1)", () => {
  it("no pages: nothing to bind", () => {
    expect(chooseMetaPage([], null)).toBeNull();
  });
  it("exactly one page: bind it", () => {
    expect(chooseMetaPage([page("1")], null)?.id).toBe("1");
  });
  it("reconnect keeps the page already bound, even among several", () => {
    expect(chooseMetaPage([page("1"), page("2")], "2")?.id).toBe("2");
  });
  it("several pages without a binding: refuse instead of data[0]", () => {
    expect(() => chooseMetaPage([page("1"), page("2")], null)).toThrow(
      META_PAGE_ERRORS.multiplePages
    );
  });
  it("bound page no longer administered and several others: refuse", () => {
    expect(() => chooseMetaPage([page("1"), page("2")], "9")).toThrow(
      META_PAGE_ERRORS.multiplePages
    );
  });
});

describe("metaPageErrorText (J-1, INT-C 9)", () => {
  it("turns the codes into sentences for the Praxis, never the raw code", () => {
    const multi = metaPageErrorText(new Error(META_PAGE_ERRORS.multiplePages));
    const bound = metaPageErrorText(new Error(META_PAGE_ERRORS.boundElsewhere));
    const other = metaPageErrorText(new Error("(#190) token expired 0171 1234567"));
    expect(multi).toContain("mehrere Seiten");
    expect(bound).toContain("anderen Praxis");
    expect(other).toContain("erneut");
    for (const t of [multi, bound, other]) {
      expect(t).not.toMatch(/meta_page_|#190|0171|—/);
    }
  });
});

// ---------------------------------------------------------------------------
// E6: Seitenauswahl. Graph is mocked (never the real API); the binding rules
// run against an in-memory store that mirrors the UNIQUE index of 0088.
// ---------------------------------------------------------------------------

interface Row {
  clinicId: string;
  accessTokenEnc: Buffer;
  expiresAt: Date | null;
  pageId: string | null;
  pageTokenEnc: Buffer | null;
  lastSyncError?: string | null;
}

function row(clinicId: string, userToken: string, pageId: string | null = null): Row {
  return {
    clinicId,
    accessTokenEnc: encryptString(userToken),
    expiresAt: new Date(Date.now() + 86_400_000),
    pageId,
    pageTokenEnc: pageId ? encryptString(`old-${pageId}`) : null,
    lastSyncError: null,
  };
}

/** Hints the binding itself leaves; writeBinding clears exactly these (as the SQL CASE). */
const PAGE_HINTS = [
  META_PAGE_ERRORS.multiplePages,
  META_PAGE_ERRORS.boundElsewhere,
  META_PAGE_ERRORS.leadgenSubscribeFailed,
].map((c) => metaPageErrorText(new Error(c)));

function memoryStore(
  rows: Row[],
  opts: { staleElsewhereCheck?: boolean; heldElsewhere?: string[] } = {}
) {
  const store: MetaBindingStore & { writes: number } = {
    writes: 0,
    async connection(clinicId) {
      const r = rows.find((x) => x.clinicId === clinicId);
      return r
        ? {
            accessTokenEnc: r.accessTokenEnc,
            expiresAt: r.expiresAt,
            pageId: r.pageId,
            pageTokenEnc: r.pageTokenEnc,
          }
        : null;
    },
    async boundToOtherClinic(clinicId, pageIds) {
      // staleElsewhereCheck: the pre-check misses a binding made in between.
      if (opts.staleElsewhereCheck) return new Set();
      // heldElsewhere: another Praxis took these pages in the meantime.
      const held = (opts.heldElsewhere ?? []).filter((id) => pageIds.includes(id));
      return new Set([
        ...held,
        ...rows
          .filter((x) => x.clinicId !== clinicId && x.pageId && pageIds.includes(x.pageId))
          .map((x) => x.pageId!),
      ]);
    },
    async writeBinding(clinicId, pageId, enc) {
      const r = rows.find((x) => x.clinicId === clinicId);
      if (!r) return false;
      // UNIQUE (meta_page_id) WHERE meta_page_id IS NOT NULL (0088).
      if (rows.some((x) => x !== r && x.pageId === pageId)) {
        const pgErr = Object.assign(new Error("duplicate key value"), { code: "23505" });
        throw Object.assign(new Error("query failed"), { cause: pgErr });
      }
      r.pageId = pageId;
      r.pageTokenEnc = enc;
      if (r.lastSyncError && PAGE_HINTS.includes(r.lastSyncError)) r.lastSyncError = null;
      store.writes++;
      return true;
    },
    async setSyncError(clinicId, text) {
      const r = rows.find((x) => x.clinicId === clinicId);
      if (r) r.lastSyncError = text;
    },
  };
  return store;
}

/**
 * Fake Graph: /me/accounts answers per user token with the requested fields;
 * /{page}/subscribed_apps (POST/DELETE) answers `subscribe` (default ok).
 */
function graphFetch(
  pagesByToken: Record<string, MetaPage[]>,
  opts: { subscribe?: "ok" | "fail"; unsubscribe?: "ok" | "fail" } = {}
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/subscribed_apps")) {
      const outcome = init?.method === "DELETE" ? opts.unsubscribe : opts.subscribe;
      return outcome === "fail"
        ? new Response(
            JSON.stringify({ error: { code: 200, message: "Requires pages_manage_metadata t-secret" } }),
            { status: 403 }
          )
        : new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const pages = pagesByToken[auth.replace(/^Bearer /, "")];
    if (!pages) {
      return new Response(
        JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token." } }),
        { status: 400 }
      );
    }
    const fields = (url.searchParams.get("fields") ?? "").split(",");
    const data = pages.map((p) =>
      Object.fromEntries(fields.map((f) => [f, p[f as keyof MetaPage]]))
    );
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}

type FetchMock = ReturnType<typeof graphFetch>;

/** The subscribed_apps calls a fetch mock saw: method, page id, bearer token, body. */
function subscriptionCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).endsWith("/subscribed_apps"))
    .map(([u, init]) => ({
      method: init?.method,
      pageId: new URL(String(u)).pathname.split("/")[2],
      token: (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, ""),
      body: init?.body,
      url: String(u),
    }));
}

const fresh = (id: string, token = `fresh-${id}`): MetaPage => ({
  id,
  name: `Seite ${id}`,
  access_token: token,
});

function noPageBoundTwice(rows: Row[]) {
  const ids = rows.map((r) => r.pageId).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("selectChosenMetaPage (E6)", () => {
  const list = [fresh("1"), fresh("2")];
  it("returns the chosen page from the fresh list", () => {
    expect(selectChosenMetaPage(list, "2").access_token).toBe("fresh-2");
  });
  it("refuses an id that is not in the fresh list", () => {
    expect(() => selectChosenMetaPage(list, "3")).toThrow(META_PAGE_ERRORS.notAdministered);
  });
  it("refuses malformed ids before any lookup", () => {
    for (const bad of ["", "abc", "1 OR 1=1", "1/../2", " 1", "1".repeat(33)]) {
      expect(() => selectChosenMetaPage(list, bad)).toThrow(META_PAGE_ERRORS.notAdministered);
    }
  });
});

describe("safeGraphNext (E6)", () => {
  it("follows paging only back to https://graph.facebook.com", () => {
    const ok = "https://graph.facebook.com/v21.0/me/accounts?after=abc";
    expect(safeGraphNext(ok)).toBe(ok);
    expect(safeGraphNext("http://graph.facebook.com/v21.0/me/accounts")).toBeNull();
    expect(safeGraphNext("https://graph.facebook.com.evil.test/x")).toBeNull();
    expect(safeGraphNext("https://evil.test/?u=https://graph.facebook.com")).toBeNull();
    expect(safeGraphNext("not a url")).toBeNull();
    expect(safeGraphNext(42)).toBeNull();
  });
});

describe("fetchMetaPages (E6, mocked Graph)", () => {
  it("sends the user token in the Authorization header, never in the URL", async () => {
    const fetchMock = graphFetch({ "user-A": [fresh("1")] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchMetaPages("user-A");
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(String(input)).not.toContain("user-A");
    expect(String(input)).not.toContain("access_token=");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-A");
  });

  it("summaries do not even request page tokens", async () => {
    const fetchMock = graphFetch({ "user-A": [fresh("1"), fresh("2")] });
    vi.stubGlobal("fetch", fetchMock);
    const pages = await fetchMetaPageSummaries("user-A");
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get("fields")).toBe("id,name");
    expect(pages).toEqual([
      { id: "1", name: "Seite 1" },
      { id: "2", name: "Seite 2" },
    ]);
    expect(JSON.stringify(pages)).not.toContain("fresh-");
  });

  it("follows paging on graph.facebook.com, stops at a foreign host, drops malformed and duplicate entries, keeps tokenless pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes("after=p2")) {
        return new Response(
          JSON.stringify({
            data: [fresh("2"), fresh("1"), fresh("3")],
            paging: { next: "https://evil.test/v21.0/me/accounts?after=p3" },
          })
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            fresh("1"),
            { id: "x1", name: "kaputt", access_token: "t" },
            { id: "4", name: "ohne Token" },
            null,
          ],
          paging: { next: "https://graph.facebook.com/v21.0/me/accounts?after=p2" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const pages = await fetchMetaPages("user-A");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("evil.test"))).toBe(false);
    // "4" has no page token: it stays listed (counts for J-1) with "".
    expect(pages.map((p) => [p.id, p.access_token])).toEqual([
      ["1", "fresh-1"],
      ["4", ""],
      ["2", "fresh-2"],
      ["3", "fresh-3"],
    ]);
  });

  it("Graph error 190 means the stored token is expired; other errors carry only the status", async () => {
    vi.stubGlobal("fetch", graphFetch({}));
    await expect(fetchMetaPages("revoked")).rejects.toThrow(META_PAGE_ERRORS.tokenExpired);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 503 }))
    );
    await expect(fetchMetaPages("user-A")).rejects.toThrow("meta /me/accounts http 503");
  });
});

describe("chooseAndStoreMetaPage (E6)", () => {
  it("binds the chosen page with the page token from the fresh list", async () => {
    const rows = [row("A", "user-A")];
    const fetchMock = graphFetch({ "user-A": [fresh("1"), fresh("2"), fresh("3")] });
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore(rows);
    const out = await chooseAndStoreMetaPage("A", "2", store);
    expect(out).toEqual({
      page: { id: "2", name: "Seite 2" },
      previousPageId: null,
      leadgenSubscribed: true,
    });
    expect(JSON.stringify(out)).not.toContain("fresh-");
    expect(rows[0]!.pageId).toBe("2");
    expect(decryptString(rows[0]!.pageTokenEnc!)).toBe("fresh-2");
    // The stored user token of THIS Praxis was used for the fresh read.
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe(
      "Bearer user-A"
    );
  });

  it("refuses an id that the Facebook user does not (or no longer) admin", async () => {
    const rows = [row("A", "user-A")];
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1"), fresh("2")] }));
    const store = memoryStore(rows);
    await expect(chooseAndStoreMetaPage("A", "99", store)).rejects.toThrow(
      META_PAGE_ERRORS.notAdministered
    );
    expect(store.writes).toBe(0);
    expect(rows[0]!.pageId).toBeNull();
  });

  it("refuses a page the user lists but has no page token for", async () => {
    const rows = [row("A", "user-A")];
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1"), fresh("2", "")] }));
    const store = memoryStore(rows);
    await expect(chooseAndStoreMetaPage("A", "2", store)).rejects.toThrow(
      META_PAGE_ERRORS.notAdministered
    );
    expect(store.writes).toBe(0);
    expect(rows[0]!.pageId).toBeNull();
  });

  it("refuses a malformed id without calling Graph", async () => {
    const fetchMock = graphFetch({ "user-A": [fresh("1")] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      chooseAndStoreMetaPage("A", "1 OR 1=1", memoryStore([row("A", "user-A")]))
    ).rejects.toThrow(META_PAGE_ERRORS.notAdministered);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never takes over a page bound to another Praxis", async () => {
    const rows = [row("A", "user-A"), row("B", "user-B", "2")];
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1"), fresh("2")] }));
    const store = memoryStore(rows);
    await expect(chooseAndStoreMetaPage("A", "2", store)).rejects.toThrow(
      META_PAGE_ERRORS.boundElsewhere
    );
    expect(store.writes).toBe(0);
    expect(rows[0]!.pageId).toBeNull();
    expect(rows[1]!.pageId).toBe("2");
    expect(decryptString(rows[1]!.pageTokenEnc!)).toBe("old-2");
  });

  it("race: the unique index refuses what the pre-check missed (23505 in cause)", async () => {
    const rows = [row("A", "user-A"), row("B", "user-B", "2")];
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1"), fresh("2")] }));
    const store = memoryStore(rows, { staleElsewhereCheck: true });
    await expect(chooseAndStoreMetaPage("A", "2", store)).rejects.toThrow(
      META_PAGE_ERRORS.boundElsewhere
    );
    expect(rows[1]!.pageId).toBe("2");
    noPageBoundTwice(rows);
  });

  it("re-bind releases the old page and keeps every page on at most one Praxis", async () => {
    const rows = [row("A", "user-A", "1"), row("B", "user-B")];
    vi.stubGlobal(
      "fetch",
      graphFetch({
        "user-A": [fresh("1"), fresh("3")],
        "user-B": [fresh("1"), fresh("3")],
      })
    );
    const store = memoryStore(rows);
    const out = await chooseAndStoreMetaPage("A", "3", store);
    expect(out.previousPageId).toBe("1");
    expect(rows[0]!.pageId).toBe("3");
    // Page 3 is taken now, page 1 is free again.
    await expect(chooseAndStoreMetaPage("B", "3", store)).rejects.toThrow(
      META_PAGE_ERRORS.boundElsewhere
    );
    await chooseAndStoreMetaPage("B", "1", store);
    expect(rows[1]!.pageId).toBe("1");
    noPageBoundTwice(rows);
  });

  it("choosing the bound page again refreshes its token", async () => {
    const rows = [row("A", "user-A", "1")];
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1", "renewed-1"), fresh("2")] }));
    await chooseAndStoreMetaPage("A", "1", memoryStore(rows));
    expect(rows[0]!.pageId).toBe("1");
    expect(decryptString(rows[0]!.pageTokenEnc!)).toBe("renewed-1");
  });

  it("no Meta row, expired or revoked user token: nothing is bound", async () => {
    const fetchMock = graphFetch({ "user-A": [fresh("1")] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(chooseAndStoreMetaPage("A", "1", memoryStore([]))).rejects.toThrow(
      META_PAGE_ERRORS.notConnected
    );
    const expired = row("A", "user-A");
    expired.expiresAt = new Date(Date.now() - 1000);
    await expect(chooseAndStoreMetaPage("A", "1", memoryStore([expired]))).rejects.toThrow(
      META_PAGE_ERRORS.tokenExpired
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const revoked = [row("A", "user-revoked")];
    await expect(chooseAndStoreMetaPage("A", "1", memoryStore(revoked))).rejects.toThrow(
      META_PAGE_ERRORS.tokenExpired
    );
    expect(revoked[0]!.pageId).toBeNull();
  });
});

describe("loadMetaPagePicker (E6)", () => {
  it("lists names and ids, marks the bound page and pages of other Praxen, carries no token", async () => {
    const rows = [row("A", "user-A", "1"), row("B", "user-B", "3")];
    const fetchMock = graphFetch({ "user-A": [fresh("1"), fresh("2"), fresh("3")] });
    vi.stubGlobal("fetch", fetchMock);
    const data = await loadMetaPagePicker("A", memoryStore(rows));
    expect(data).toEqual({
      status: "ok",
      currentPageId: "1",
      pages: [
        { id: "1", name: "Seite 1", current: true, boundElsewhere: false },
        { id: "2", name: "Seite 2", current: false, boundElsewhere: false },
        { id: "3", name: "Seite 3", current: false, boundElsewhere: true },
      ],
    });
    expect(JSON.stringify(data)).not.toMatch(/fresh-|user-A|access_token/);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get("fields")).toBe(
      "id,name"
    );
  });

  it("states without a usable connection", async () => {
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1")] }));
    expect(await loadMetaPagePicker("A", memoryStore([]))).toEqual({ status: "not_connected" });
    const expired = row("A", "user-A");
    expired.expiresAt = new Date(Date.now() - 1000);
    expect(await loadMetaPagePicker("A", memoryStore([expired]))).toEqual({
      status: "token_expired",
    });
    expect(await loadMetaPagePicker("A", memoryStore([row("A", "user-revoked")]))).toEqual({
      status: "token_expired",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await loadMetaPagePicker("A", memoryStore([row("A", "user-A")]))).toEqual({
      status: "fetch_failed",
    });
  });
});

describe("discoverAndStoreMetaPage (J-1 rules via bindMetaPage)", () => {
  it("binds the only page, refuses several, keeps the bound page among several", async () => {
    vi.stubGlobal("fetch", graphFetch({ one: [fresh("1")], many: [fresh("1"), fresh("2")] }));
    const rowsOne = [row("A", "x")];
    expect(await discoverAndStoreMetaPage("A", "one", memoryStore(rowsOne))).toEqual({
      page: { id: "1", name: "Seite 1" },
      leadgenSubscribed: true,
    });
    expect(rowsOne[0]!.pageId).toBe("1");

    const rowsMany = [row("A", "x")];
    await expect(discoverAndStoreMetaPage("A", "many", memoryStore(rowsMany))).rejects.toThrow(
      META_PAGE_ERRORS.multiplePages
    );
    expect(rowsMany[0]!.pageId).toBeNull();

    const rowsBound = [row("A", "x", "2")];
    await discoverAndStoreMetaPage("A", "many", memoryStore(rowsBound));
    expect(rowsBound[0]!.pageId).toBe("2");
    expect(decryptString(rowsBound[0]!.pageTokenEnc!)).toBe("fresh-2");
  });

  it("a tokenless second page still counts: no auto-binding of the other one (J-1)", async () => {
    vi.stubGlobal("fetch", graphFetch({ mixed: [fresh("1"), fresh("2", "")] }));
    const rows = [row("A", "x")];
    await expect(discoverAndStoreMetaPage("A", "mixed", memoryStore(rows))).rejects.toThrow(
      META_PAGE_ERRORS.multiplePages
    );
    expect(rows[0]!.pageId).toBeNull();
  });

  it("refuses the only page when another Praxis holds it", async () => {
    vi.stubGlobal("fetch", graphFetch({ one: [fresh("1")] }));
    const rows = [row("A", "x"), row("B", "y", "1")];
    await expect(discoverAndStoreMetaPage("A", "one", memoryStore(rows))).rejects.toThrow(
      META_PAGE_ERRORS.boundElsewhere
    );
    expect(rows[0]!.pageId).toBeNull();
    noPageBoundTwice(rows);
  });
});

describe("META_PAGES_FIXTURE (local visual check only)", () => {
  it("outside production the flag replaces the Graph call", async () => {
    vi.stubEnv("META_PAGES_FIXTURE", "1");
    const fetchMock = graphFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const pages = await fetchMetaPages("anything");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pages.map((p) => p.id)).toEqual(META_PAGES_FIXTURE.map((p) => p.id));
  });

  it("is ignored in production", async () => {
    vi.stubEnv("META_PAGES_FIXTURE", "1");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = graphFetch({ "user-A": [fresh("1")] });
    vi.stubGlobal("fetch", fetchMock);
    const pages = await fetchMetaPages("user-A");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pages.map((p) => p.id)).toEqual(["1"]);
  });
});

describe("metaPageChoiceErrorText (E6)", () => {
  it("German sentences for every code, never the raw code", () => {
    const codes = [
      META_PAGE_ERRORS.boundElsewhere,
      META_PAGE_ERRORS.notAdministered,
      META_PAGE_ERRORS.notConnected,
      META_PAGE_ERRORS.tokenExpired,
      "meta /me/accounts http 500",
    ];
    for (const c of codes) {
      const t = metaPageChoiceErrorText(new Error(c));
      expect(t).toMatch(/Bitte/);
      expect(t).not.toMatch(/meta_|http|—/);
    }
    expect(metaPageChoiceErrorText(new Error(META_PAGE_ERRORS.boundElsewhere))).toContain(
      "anderen Praxis"
    );
  });
});

// ---------------------------------------------------------------------------
// E6b: leadgen subscription after every binding (Graph mocked).
// ---------------------------------------------------------------------------

describe("leadgen subscription (E6b)", () => {
  const LEADGEN_HINT = metaPageErrorText(new Error(META_PAGE_ERRORS.leadgenSubscribeFailed));

  it("OAuth start asks for pages_manage_metadata next to the lead permissions", () => {
    expect(META_OAUTH_SCOPES).toEqual(
      expect.arrayContaining(["pages_manage_metadata", "leads_retrieval", "pages_show_list"])
    );
  });

  it("after binding: POST subscribed_apps for leadgen with the page token in the header", async () => {
    const rows = [row("A", "user-A")];
    const fetchMock = graphFetch({ "user-A": [fresh("1"), fresh("2")] });
    vi.stubGlobal("fetch", fetchMock);
    const out = await chooseAndStoreMetaPage("A", "2", memoryStore(rows));
    expect(out.leadgenSubscribed).toBe(true);
    const calls = subscriptionCalls(fetchMock);
    expect(calls.map(({ url: _u, ...c }) => c)).toEqual([
      { method: "POST", pageId: "2", token: "fresh-2", body: "subscribed_fields=leadgen" },
    ]);
    expect(calls[0]!.url).toMatch(/^https:\/\/graph\.facebook\.com\/[^/]+\/2\/subscribed_apps$/);
    expect(calls[0]!.url).not.toContain("fresh-2");
    expect(rows[0]!.lastSyncError).toBeNull();
  });

  it("the callback's auto-binding subscribes too", async () => {
    const rows = [row("A", "x")];
    const fetchMock = graphFetch({ one: [fresh("7")] });
    vi.stubGlobal("fetch", fetchMock);
    const out = await discoverAndStoreMetaPage("A", "one", memoryStore(rows));
    expect(out?.leadgenSubscribed).toBe(true);
    expect(subscriptionCalls(fetchMock).map((c) => [c.method, c.pageId, c.token])).toEqual([
      ["POST", "7", "fresh-7"],
    ]);
  });

  it("a failed subscription keeps the binding, stores a German hint, logs clinic id and Graph code only", async () => {
    const rows = [row("A", "user-A")];
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1")] }, { subscribe: "fail" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await chooseAndStoreMetaPage("A", "1", memoryStore(rows));
    expect(out.leadgenSubscribed).toBe(false);
    expect(rows[0]!.pageId).toBe("1");
    expect(decryptString(rows[0]!.pageTokenEnc!)).toBe("fresh-1");
    expect(rows[0]!.lastSyncError).toBe(LEADGEN_HINT);
    expect(LEADGEN_HINT).not.toMatch(/meta_|leadgen|http|—/);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('\\"clinicId\\":\\"A\\"');
    expect(logged).toContain('\\"graphCode\\":200');
    expect(logged).not.toMatch(/fresh-1|user-A|t-secret|pages_manage_metadata/);
  });

  it("re-binding the same page re-subscribes harmlessly and clears an earlier hint", async () => {
    const rows = [row("A", "user-A", "1")];
    rows[0]!.lastSyncError = LEADGEN_HINT;
    const fetchMock = graphFetch({ "user-A": [fresh("1")] });
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore(rows);
    await chooseAndStoreMetaPage("A", "1", store);
    await chooseAndStoreMetaPage("A", "1", store);
    expect(subscriptionCalls(fetchMock).map((c) => c.method)).toEqual(["POST", "POST"]);
    expect(rows[0]!.pageId).toBe("1");
    expect(rows[0]!.lastSyncError).toBeNull();
  });

  it("a real sync error is not overwritten by a successful subscription", async () => {
    const rows = [row("A", "user-A")];
    rows[0]!.lastSyncError = "Abgleich fehlgeschlagen";
    vi.stubGlobal("fetch", graphFetch({ "user-A": [fresh("1")] }));
    await chooseAndStoreMetaPage("A", "1", memoryStore(rows));
    expect(rows[0]!.lastSyncError).toBe("Abgleich fehlgeschlagen");
  });

  it("switch A -> B: subscribes B, unsubscribes A (fresh token) once no Praxis holds A", async () => {
    const rows = [row("X", "user-X", "1")];
    const fetchMock = graphFetch({ "user-X": [fresh("1"), fresh("2")] });
    vi.stubGlobal("fetch", fetchMock);
    const out = await chooseAndStoreMetaPage("X", "2", memoryStore(rows));
    expect(out.previousPageId).toBe("1");
    expect(subscriptionCalls(fetchMock).map((c) => [c.method, c.pageId, c.token])).toEqual([
      ["POST", "2", "fresh-2"],
      ["DELETE", "1", "fresh-1"],
    ]);
  });

  it("switch A -> B keeps A subscribed when another Praxis holds A by then", async () => {
    const rows = [row("X", "user-X", "1")];
    const fetchMock = graphFetch({ "user-X": [fresh("1"), fresh("2")] });
    vi.stubGlobal("fetch", fetchMock);
    await chooseAndStoreMetaPage("X", "2", memoryStore(rows, { heldElsewhere: ["1"] }));
    expect(subscriptionCalls(fetchMock).map((c) => [c.method, c.pageId])).toEqual([["POST", "2"]]);
  });

  it("switch away from a page the user no longer admins: unsubscribe with the stored token", async () => {
    const rows = [row("X", "x", "9")];
    const fetchMock = graphFetch({ one: [fresh("2")] });
    vi.stubGlobal("fetch", fetchMock);
    await discoverAndStoreMetaPage("X", "one", memoryStore(rows));
    expect(rows[0]!.pageId).toBe("2");
    expect(subscriptionCalls(fetchMock).map((c) => [c.method, c.pageId, c.token])).toEqual([
      ["POST", "2", "fresh-2"],
      ["DELETE", "9", "old-9"],
    ]);
  });

  it("a failed unsubscribe of A is swallowed: B stays bound and subscribed", async () => {
    const rows = [row("X", "user-X", "1")];
    vi.stubGlobal("fetch", graphFetch({ "user-X": [fresh("1"), fresh("2")] }, { unsubscribe: "fail" }));
    const out = await chooseAndStoreMetaPage("X", "2", memoryStore(rows));
    expect(out.leadgenSubscribed).toBe(true);
    expect(rows[0]!.pageId).toBe("2");
    expect(rows[0]!.lastSyncError).toBeNull();
  });

  it("a refused binding (page of another Praxis) touches no subscription", async () => {
    const rows = [row("A", "user-A", "1"), row("B", "user-B", "2")];
    const fetchMock = graphFetch({ "user-A": [fresh("1"), fresh("2")] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(chooseAndStoreMetaPage("A", "2", memoryStore(rows))).rejects.toThrow(
      META_PAGE_ERRORS.boundElsewhere
    );
    expect(subscriptionCalls(fetchMock)).toEqual([]);
  });

  it("local fixture mode never calls subscribed_apps", async () => {
    vi.stubEnv("META_PAGES_FIXTURE", "1");
    const rows = [row("A", "user-A")];
    const fetchMock = graphFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const out = await chooseAndStoreMetaPage("A", META_PAGES_FIXTURE[0]!.id, memoryStore(rows));
    expect(out.leadgenSubscribed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("releaseDisconnectedMetaPage (E6b, Trennen)", () => {
  it("unsubscribes the page with its stored token once no Praxis holds it", async () => {
    const fetchMock = graphFetch({});
    vi.stubGlobal("fetch", fetchMock);
    await releaseDisconnectedMetaPage("X", "9", encryptString("old-9"), memoryStore([]));
    expect(subscriptionCalls(fetchMock).map((c) => [c.method, c.pageId, c.token])).toEqual([
      ["DELETE", "9", "old-9"],
    ]);
  });

  it("leaves the page alone when another Praxis holds it, or without page or token", async () => {
    const fetchMock = graphFetch({});
    vi.stubGlobal("fetch", fetchMock);
    await releaseDisconnectedMetaPage("X", "1", encryptString("old-1"), memoryStore([row("Y", "y", "1")]));
    await releaseDisconnectedMetaPage("X", null, encryptString("t"), memoryStore([]));
    await releaseDisconnectedMetaPage("X", "2", null, memoryStore([]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed unsubscribe is swallowed", async () => {
    vi.stubGlobal("fetch", graphFetch({}, { unsubscribe: "fail" }));
    await expect(
      releaseDisconnectedMetaPage("X", "9", encryptString("old-9"), memoryStore([]))
    ).resolves.toBeUndefined();
  });
});
