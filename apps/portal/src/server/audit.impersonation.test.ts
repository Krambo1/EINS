import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Decision c: writes inside an "Als Benutzer öffnen" session stay allowed, and
 * every one of them is attributable to the admin through
 * audit_log.impersonated_by_admin_id, filled automatically by writeAudit.
 */
const { valuesMock, getSessionMock } = vi.hoisted(() => ({
  valuesMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert: () => ({ values: valuesMock }) },
  schema: { auditLog: {} },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "vitest" }),
}));
vi.mock("@/auth/session", () => ({ getSession: getSessionMock }));

import { resolveImpersonatingAdminId, writeAudit } from "./audit";

const ADMIN = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  valuesMock.mockReset().mockResolvedValue(undefined);
  getSessionMock.mockReset();
});

describe("resolveImpersonatingAdminId", () => {
  it("uses an explicit value, including an explicit null", async () => {
    const lookup = vi.fn();
    expect(await resolveImpersonatingAdminId({ impersonatedByAdminId: ADMIN }, lookup)).toBe(ADMIN);
    expect(await resolveImpersonatingAdminId({ impersonatedByAdminId: null }, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reads the current session when nothing is passed", async () => {
    expect(
      await resolveImpersonatingAdminId({}, async () => ({ impersonatedByAdminId: ADMIN }))
    ).toBe(ADMIN);
    expect(
      await resolveImpersonatingAdminId({}, async () => ({ impersonatedByAdminId: null }))
    ).toBeNull();
    expect(await resolveImpersonatingAdminId({}, async () => null)).toBeNull();
  });

  it("does not look up a session for worker-style calls with requestMeta", async () => {
    const lookup = vi.fn();
    expect(
      await resolveImpersonatingAdminId({ requestMeta: { ip: null, ua: null } }, lookup)
    ).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("never throws when the lookup fails (outside a request)", async () => {
    expect(
      await resolveImpersonatingAdminId({}, async () => {
        throw new Error("headers() outside request scope");
      })
    ).toBeNull();
  });
});

describe("writeAudit attribution", () => {
  it("stamps the impersonating admin on a write made in an admin view", async () => {
    getSessionMock.mockResolvedValueOnce({ impersonatedByAdminId: ADMIN });
    await writeAudit({ clinicId: "c1", actorId: "u1", action: "update", entityKind: "request" });
    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(valuesMock.mock.calls[0]![0]).toMatchObject({
      action: "update",
      impersonatedByAdminId: ADMIN,
      ipAddress: "203.0.113.9",
    });
  });

  it("leaves the column empty for the real user", async () => {
    getSessionMock.mockResolvedValueOnce({ impersonatedByAdminId: null });
    await writeAudit({ clinicId: "c1", actorId: "u1", action: "update" });
    expect(valuesMock.mock.calls[0]![0].impersonatedByAdminId).toBeUndefined();
  });
});
