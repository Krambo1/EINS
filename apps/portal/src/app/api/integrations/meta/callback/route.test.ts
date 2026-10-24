import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Meta OAuth callback (E6 / E6b): stores the connection, binds the page via
 * discoverAndStoreMetaPage (which also subscribes leadgen), sends the owner
 * to the page picker when the account has several pages, and records the
 * outcome in the audit. Graph is never called: fetch is stubbed for the two
 * token exchanges, discoverAndStoreMetaPage is mocked.
 */
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  readStateCookie: vi.fn(),
  verifyState: vi.fn(),
  clearStateCookie: vi.fn(),
  writeAudit: vi.fn(),
  discover: vi.fn(),
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("@/auth/guards", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/server/oauth", () => ({
  verifyState: mocks.verifyState,
  readStateCookie: mocks.readStateCookie,
  clearStateCookie: mocks.clearStateCookie,
}));
vi.mock("@/server/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/env", () => ({
  env: {
    APP_ORIGIN: "http://localhost:3001",
    META_API_VERSION: "v21.0",
    META_APP_ID: "app-id",
    META_APP_SECRET: "app-secret",
    META_REDIRECT_URI: "http://localhost:3001/api/integrations/meta/callback",
  },
  hasMeta: () => true,
}));
vi.mock("@/lib/crypto", () => ({
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
}));
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
    update: () => ({
      set: (v: unknown) => {
        mocks.updateSet(v);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({ values: mocks.insertValues }),
  },
  schema: { platformCredentials: { id: {}, clinicId: {}, platform: {} } },
}));
vi.mock("@/server/meta-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/meta-pages")>()),
  discoverAndStoreMetaPage: mocks.discover,
}));

import { GET } from "./route";
import { META_PAGE_ERRORS, metaPageErrorText } from "@/server/meta-pages";

const ORIGIN = "http://localhost:3001";
const SESSION = { clinicId: "clinic-1", userId: "user-1", email: "inhaber@praxis.test" };

function callback(query = "code=auth-code&state=st-1") {
  return new NextRequest(`${ORIGIN}/api/integrations/meta/callback?${query}`);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.requireSession.mockResolvedValue(SESSION);
  mocks.readStateCookie.mockResolvedValue("st-1");
  mocks.verifyState.mockResolvedValue({ clinicId: "clinic-1", userId: "user-1", platform: "meta" });
  mocks.selectLimit.mockResolvedValue([{ id: "row-1" }]);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    expect(u.origin).toBe("https://graph.facebook.com");
    expect(u.pathname).toMatch(/\/oauth\/access_token$/);
    return u.searchParams.get("grant_type") === "fb_exchange_token"
      ? new Response(JSON.stringify({ access_token: "long-user-token", expires_in: 5_184_000 }))
      : new Response(JSON.stringify({ access_token: "short-user-token" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function location(res: Response): string {
  return res.headers.get("location") ?? "";
}

describe("GET /api/integrations/meta/callback", () => {
  it("binds the page with the long-lived user token and audits a working leadgen subscription", async () => {
    mocks.discover.mockResolvedValue({ page: { id: "1", name: "Praxis Dr. Test" }, leadgenSubscribed: true });
    const res = await GET(callback());
    expect(location(res)).toBe(`${ORIGIN}/einstellungen?connected=meta#integrationen`);
    expect(mocks.discover).toHaveBeenCalledWith("clinic-1", "long-user-token");
    // The stored connection: encrypted long-lived token, old error cleared.
    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet.mock.calls[0]![0]).toMatchObject({
      accessTokenEnc: Buffer.from("enc:long-user-token"),
      lastSyncError: null,
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "oauth_connect",
        diff: {
          platform: "meta",
          pageName: "Praxis Dr. Test",
          pageSelectionRequired: false,
          leadgenSubscribed: true,
        },
      })
    );
  });

  it("E6b: a failed leadgen subscription still completes the connection and is audited", async () => {
    mocks.discover.mockResolvedValue({ page: { id: "1", name: "Praxis Dr. Test" }, leadgenSubscribed: false });
    const res = await GET(callback());
    expect(location(res)).toBe(`${ORIGIN}/einstellungen?connected=meta#integrationen`);
    expect(mocks.writeAudit.mock.calls[0]![0].diff).toMatchObject({ leadgenSubscribed: false });
    // The hint itself is written inside bindMetaPage, not by the route.
    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
  });

  it("E6: several pages send the owner to the picker, the hint stays, nothing secret in the URL", async () => {
    mocks.discover.mockRejectedValue(new Error(META_PAGE_ERRORS.multiplePages));
    const res = await GET(callback());
    const loc = location(res);
    expect(loc).toBe(`${ORIGIN}/einstellungen/integrationen/meta-seite`);
    expect(loc).not.toMatch(/token|auth-code|st-1/);
    expect(mocks.updateSet).toHaveBeenLastCalledWith({
      lastSyncError: metaPageErrorText(new Error(META_PAGE_ERRORS.multiplePages)),
    });
    expect(mocks.writeAudit.mock.calls[0]![0].diff).toMatchObject({
      pageSelectionRequired: true,
      pageName: null,
      leadgenSubscribed: null,
    });
  });

  it("a page bound to another Praxis is reported, the owner is not sent to the picker", async () => {
    mocks.discover.mockRejectedValue(new Error(META_PAGE_ERRORS.boundElsewhere));
    const res = await GET(callback());
    expect(location(res)).toBe(`${ORIGIN}/einstellungen?connected=meta#integrationen`);
    expect(mocks.updateSet).toHaveBeenLastCalledWith({
      lastSyncError: metaPageErrorText(new Error(META_PAGE_ERRORS.boundElsewhere)),
    });
  });

  it("a state that does not match the cookie stops before any token exchange", async () => {
    mocks.readStateCookie.mockResolvedValue("other-state");
    const res = await GET(callback());
    expect(location(res)).toBe(`${ORIGIN}/einstellungen?error=oauth_state`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("a state issued to another Praxis or user is refused", async () => {
    mocks.verifyState.mockResolvedValue({ clinicId: "clinic-2", userId: "user-1", platform: "meta" });
    const res = await GET(callback());
    expect(location(res)).toBe(`${ORIGIN}/einstellungen?error=oauth_state`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
