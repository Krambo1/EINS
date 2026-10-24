import { describe, expect, it } from "vitest";
import {
  ImpersonationBlockedError,
  assertNotImpersonating,
  impersonationBlockedMessage,
  isImpersonating,
  type ImpersonationBlockedAction,
} from "./impersonation-guard";

const admin = { impersonatedByAdminId: "00000000-0000-4000-8000-000000000001" };
const user = { impersonatedByAdminId: null };
const actions: ImpersonationBlockedAction[] = ["password", "login_email", "logout_all_devices"];

describe("impersonation guard (decision c)", () => {
  it("detects an admin view", () => {
    expect(isImpersonating(admin)).toBe(true);
    expect(isImpersonating(user)).toBe(false);
  });

  it("blocks the three account-takeover actions while impersonating", () => {
    for (const action of actions) {
      expect(() => assertNotImpersonating(admin, action)).toThrow(ImpersonationBlockedError);
      try {
        assertNotImpersonating(admin, action);
      } catch (err) {
        expect((err as ImpersonationBlockedError).action).toBe(action);
        expect((err as Error).message).toBe(impersonationBlockedMessage(action));
      }
    }
  });

  it("lets the real user do all of them", () => {
    for (const action of actions) {
      expect(() => assertNotImpersonating(user, action)).not.toThrow();
    }
  });

  it("messages are German, formal and free of em-dashes", () => {
    for (const action of actions) {
      const msg = impersonationBlockedMessage(action);
      expect(msg).toMatch(/Ansicht als Benutzer/);
      expect(msg).not.toContain("—");
    }
  });
});
