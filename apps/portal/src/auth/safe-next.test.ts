import { describe, expect, it } from "vitest";
import { loginRedirectPath, safeNextPath } from "./safe-next";

describe("safeNextPath (B-6)", () => {
  it("accepts relative portal paths incl. query and hash", () => {
    expect(safeNextPath("/anfragen")).toBe("/anfragen");
    expect(safeNextPath("/anfragen/123?tab=verlauf#notizen")).toBe(
      "/anfragen/123?tab=verlauf#notizen"
    );
  });

  it("rejects open-redirect shapes", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "evil.example",
      "javascript:alert(1)",
      "/\t/evil.example",
      "/foo\r\nSet-Cookie: x=1",
      "/foo bar",
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it("rejects the auth, API and admin surfaces", () => {
    for (const bad of [
      "/login",
      "/login?next=/x",
      "/set-password",
      "/forgot-password",
      "/api/auth/logout",
      "/admin",
      "/ADMIN/clinics",
      "/_next/static/x.js",
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
    // Prefix match is per segment, not per character.
    expect(safeNextPath("/administration-hinweis")).toBe("/administration-hinweis");
  });

  it("rejects non-strings, too short and too long input", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(42)).toBeNull();
    expect(safeNextPath("/")).toBeNull();
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBeNull();
  });
});

describe("loginRedirectPath", () => {
  it("builds /login with optional error and safe next", () => {
    expect(loginRedirectPath({})).toBe("/login");
    expect(loginRedirectPath({ expired: true })).toBe("/login?error=session_expired");
    expect(loginRedirectPath({ next: "/dashboard" })).toBe("/login?next=%2Fdashboard");
    expect(loginRedirectPath({ next: "//evil.example", expired: true })).toBe(
      "/login?error=session_expired"
    );
  });
});
