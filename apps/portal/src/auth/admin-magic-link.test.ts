import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Single-use semantics for the admin login token store (`admin_tokens`).
 *
 * The atomic guarantee lives in SQL (`DELETE ... RETURNING` on a non-expired,
 * purpose-filtered row); a unit test with a mocked db can only verify the JS
 * branching around it — but that branching is the regression-prone part: a
 * deleted row → email + session; no row (expired / already burned) → null;
 * deleted row for a non-admin → null. The atomicity itself is covered by the
 * live Postgres verification step.
 */
const {
  returningMock,
  deleteMock,
  selectLimitMock,
  ensureAdminUserMock,
  createAdminSessionMock,
  isAdminEmailMock,
} = vi.hoisted(() => ({
  returningMock: vi.fn(),
  deleteMock: vi.fn(),
  selectLimitMock: vi.fn(),
  ensureAdminUserMock: vi.fn(),
  createAdminSessionMock: vi.fn(),
  isAdminEmailMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    delete: (...args: unknown[]) => {
      deleteMock(...args);
      return { where: () => ({ returning: returningMock }) };
    },
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimitMock }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
  },
  schema: {
    adminTokens: { tokenHash: {}, purpose: {}, expiresAt: {}, email: {} },
  },
}));
vi.mock("@/server/email", () => ({ sendMagicLinkEmail: async () => {} }));
vi.mock("./admin", () => ({
  isAdminEmail: (e: string) => isAdminEmailMock(e),
  ensureAdminUser: (e: string) => ensureAdminUserMock(e),
  createAdminSession: (id: string) => createAdminSessionMock(id),
}));

import { consumeAdminMagicLink, peekAdminToken } from "./admin-magic-link";

/** Real tokens are 32 random bytes base64url (43 chars); short junk is rejected up front. */
const TOKEN = "A".repeat(43);

beforeEach(() => {
  returningMock.mockReset();
  deleteMock.mockReset();
  selectLimitMock.mockReset();
  ensureAdminUserMock.mockReset().mockResolvedValue({ id: "admin-1" });
  createAdminSessionMock.mockReset().mockResolvedValue(undefined);
  isAdminEmailMock.mockReset().mockReturnValue(true);
});

describe("consumeAdminMagicLink single-use", () => {
  it("returns the email and creates a session when a fresh row is deleted", async () => {
    returningMock.mockResolvedValueOnce([{ email: "admin@eins.ag" }]);
    const email = await consumeAdminMagicLink(TOKEN);
    expect(email).toBe("admin@eins.ag");
    expect(ensureAdminUserMock).toHaveBeenCalledWith("admin@eins.ag");
    expect(createAdminSessionMock).toHaveBeenCalledWith("admin-1");
  });

  it("returns null when no row matches (expired / already used)", async () => {
    returningMock.mockResolvedValueOnce([]);
    const email = await consumeAdminMagicLink(TOKEN);
    expect(email).toBeNull();
    expect(createAdminSessionMock).not.toHaveBeenCalled();
  });

  it("returns null when the deleted row's email is not an admin", async () => {
    returningMock.mockResolvedValueOnce([{ email: "evil@x.de" }]);
    isAdminEmailMock.mockReturnValue(false);
    const email = await consumeAdminMagicLink(TOKEN);
    expect(email).toBeNull();
    expect(createAdminSessionMock).not.toHaveBeenCalled();
  });
});

describe("admin link landing page (B-1)", () => {
  it("peek reads the token without deleting it", async () => {
    selectLimitMock.mockResolvedValueOnce([{ purpose: "login" }]);
    expect(await peekAdminToken(TOKEN)).toEqual({ ok: true, purpose: "login" });
    selectLimitMock.mockResolvedValueOnce([{ purpose: "password_reset" }]);
    expect(await peekAdminToken(TOKEN)).toEqual({ ok: true, purpose: "password_reset" });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("peek reports unknown, expired or used tokens without detail", async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    expect(await peekAdminToken(TOKEN)).toEqual({ ok: false, reason: "invalid_or_expired" });
    selectLimitMock.mockResolvedValueOnce([{ purpose: "something_else" }]);
    expect(await peekAdminToken(TOKEN)).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("implausible tokens never reach the database", async () => {
    expect(await peekAdminToken("tok")).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(await consumeAdminMagicLink("tok")).toBeNull();
    expect(await consumeAdminMagicLink(`${TOKEN}'--`)).toBeNull();
    expect(selectLimitMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
