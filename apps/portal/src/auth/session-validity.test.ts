import { describe, expect, it } from "vitest";
import {
  sessionMaxAgeSeconds,
  sessionRejectReason,
  shouldTouchLastSeen,
  type SessionRowForValidation,
} from "./session-validity";

const now = new Date("2026-10-07T10:00:00Z");
const later = new Date("2026-10-07T18:00:00Z");
const isAdmin = (email: string) => email === "karam@eins.ag";

function row(over: Partial<SessionRowForValidation> = {}): SessionRowForValidation {
  return {
    revokedAt: null,
    expiresAt: later,
    userArchivedAt: null,
    clinicArchivedAt: null,
    impersonatedByAdminId: null,
    impersonatorEmail: null,
    impersonatorHasActiveSession: null,
    ...over,
  };
}

describe("sessionRejectReason", () => {
  it("accepts a live session of an active user in an active Praxis", () => {
    expect(sessionRejectReason(row(), now, isAdmin)).toBeNull();
  });

  it("rejects revoked and expired sessions", () => {
    expect(sessionRejectReason(row({ revokedAt: now }), now, isAdmin)).toBe("revoked");
    expect(sessionRejectReason(row({ expiresAt: now }), now, isAdmin)).toBe("expired");
    expect(
      sessionRejectReason(row({ expiresAt: new Date(now.getTime() - 1) }), now, isAdmin)
    ).toBe("expired");
  });

  it("locks out an archived team member (B-11)", () => {
    expect(sessionRejectReason(row({ userArchivedAt: now }), now, isAdmin)).toBe("user_archived");
  });

  it("locks out every user of an archived Praxis (B-12 / G-05)", () => {
    expect(sessionRejectReason(row({ clinicArchivedAt: now }), now, isAdmin)).toBe(
      "clinic_archived"
    );
  });

  it("accepts an impersonation session only while the admin is allowed and logged in (B-25)", () => {
    const imp = {
      impersonatedByAdminId: "00000000-0000-4000-8000-000000000001",
      impersonatorEmail: "karam@eins.ag",
      impersonatorHasActiveSession: true,
    };
    expect(sessionRejectReason(row(imp), now, isAdmin)).toBeNull();
    expect(
      sessionRejectReason(row({ ...imp, impersonatorEmail: "former@eins.ag" }), now, isAdmin)
    ).toBe("impersonator_not_allowed");
    expect(sessionRejectReason(row({ ...imp, impersonatorEmail: null }), now, isAdmin)).toBe(
      "impersonator_not_allowed"
    );
    expect(
      sessionRejectReason(row({ ...imp, impersonatorHasActiveSession: false }), now, isAdmin)
    ).toBe("impersonator_logged_out");
    expect(
      sessionRejectReason(row({ ...imp, impersonatorHasActiveSession: null }), now, isAdmin)
    ).toBe("impersonator_logged_out");
  });

  it("archive checks win over a valid impersonation (admin cannot view an archived Praxis)", () => {
    expect(
      sessionRejectReason(
        row({
          clinicArchivedAt: now,
          impersonatedByAdminId: "00000000-0000-4000-8000-000000000001",
          impersonatorEmail: "karam@eins.ag",
          impersonatorHasActiveSession: true,
        }),
        now,
        isAdmin
      )
    ).toBe("clinic_archived");
  });
});

describe("shouldTouchLastSeen", () => {
  it("writes when never seen or older than the throttle", () => {
    expect(shouldTouchLastSeen(null, now, 300)).toBe(true);
    expect(shouldTouchLastSeen(new Date(now.getTime() - 300_000), now, 300)).toBe(true);
  });
  it("skips the write inside the throttle window", () => {
    expect(shouldTouchLastSeen(new Date(now.getTime() - 299_000), now, 300)).toBe(false);
  });
});

describe("sessionMaxAgeSeconds", () => {
  const limits = { normal: 8 * 3600, remember: 30 * 86400, impersonation: 30 * 60 };
  it("uses the normal or remember-me lifetime", () => {
    expect(sessionMaxAgeSeconds({}, limits)).toBe(limits.normal);
    expect(sessionMaxAgeSeconds({ rememberMe: true }, limits)).toBe(limits.remember);
  });
  it("caps impersonation even with remember-me", () => {
    expect(
      sessionMaxAgeSeconds({ impersonatedByAdminId: "x", rememberMe: true }, limits)
    ).toBe(limits.impersonation);
  });
});
