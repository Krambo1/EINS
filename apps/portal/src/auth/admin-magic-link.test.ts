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
  ensureAdminUserMock,
  createAdminSessionMock,
  isAdminEmailMock,
} = vi.hoisted(() => ({
  returningMock: vi.fn(),
  ensureAdminUserMock: vi.fn(),
  createAdminSessionMock: vi.fn(),
  isAdminEmailMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    delete: () => ({ where: () => ({ returning: returningMock }) }),
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

import { consumeAdminMagicLink } from "./admin-magic-link";

beforeEach(() => {
  returningMock.mockReset();
  ensureAdminUserMock.mockReset().mockResolvedValue({ id: "admin-1" });
  createAdminSessionMock.mockReset().mockResolvedValue(undefined);
  isAdminEmailMock.mockReset().mockReturnValue(true);
});

describe("consumeAdminMagicLink single-use", () => {
  it("returns the email and creates a session when a fresh row is deleted", async () => {
    returningMock.mockResolvedValueOnce([{ email: "admin@eins.ag" }]);
    const email = await consumeAdminMagicLink("tok");
    expect(email).toBe("admin@eins.ag");
    expect(ensureAdminUserMock).toHaveBeenCalledWith("admin@eins.ag");
    expect(createAdminSessionMock).toHaveBeenCalledWith("admin-1");
  });

  it("returns null when no row matches (expired / already used)", async () => {
    returningMock.mockResolvedValueOnce([]);
    const email = await consumeAdminMagicLink("tok");
    expect(email).toBeNull();
    expect(createAdminSessionMock).not.toHaveBeenCalled();
  });

  it("returns null when the deleted row's email is not an admin", async () => {
    returningMock.mockResolvedValueOnce([{ email: "evil@x.de" }]);
    isAdminEmailMock.mockReturnValue(false);
    const email = await consumeAdminMagicLink("tok");
    expect(email).toBeNull();
    expect(createAdminSessionMock).not.toHaveBeenCalled();
  });
});
