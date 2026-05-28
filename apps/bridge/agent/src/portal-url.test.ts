import { describe, expect, it } from "vitest";
import { validatePortalUrl } from "./portal-url";

/**
 * P0-4 validator tests.
 *
 * The agent POSTs canonical patient events (incl. identifiable PVS patient
 * ids, demographics, and treatment data) to whatever URL is configured.
 * Any path that lets that POST go out on http:// is a DSGVO-tier incident,
 * so the validator's contract is intentionally narrow: https only, with
 * one explicit dev-only loopback exception.
 */

describe("validatePortalUrl", () => {
  it("accepts a vanilla https URL", () => {
    const r = validatePortalUrl("https://portal.einsvisuals.de", false);
    expect(r.ok).toBe(true);
  });

  it("accepts https URLs with paths, ports, and trailing slashes", () => {
    expect(validatePortalUrl("https://portal.einsvisuals.de/", false).ok).toBe(true);
    expect(validatePortalUrl("https://staging.einsvisuals.de:8443/api", false).ok).toBe(true);
  });

  it("rejects http:// for an internet host even when --allow-insecure-dev is set", () => {
    const r = validatePortalUrl(
      "http://portal.einsvisuals.de",
      /* allowInsecureDev */ true
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/localhost/);
  });

  it("rejects http:// without --allow-insecure-dev, even for localhost", () => {
    const r = validatePortalUrl("http://localhost:3000", false);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/https:\/\//);
  });

  it("accepts http://localhost ONLY when --allow-insecure-dev is set", () => {
    expect(validatePortalUrl("http://localhost", true).ok).toBe(true);
    expect(validatePortalUrl("http://localhost:3000", true).ok).toBe(true);
    expect(validatePortalUrl("http://127.0.0.1:3000", true).ok).toBe(true);
    expect(validatePortalUrl("http://[::1]:3000", true).ok).toBe(true);
  });

  it("rejects schemes other than http/https (file://, javascript:, data:, etc.)", () => {
    expect(validatePortalUrl("file:///etc/passwd", true).ok).toBe(false);
    expect(validatePortalUrl("javascript:alert(1)", true).ok).toBe(false);
    expect(validatePortalUrl("ftp://ftp.einsvisuals.de", true).ok).toBe(false);
    expect(validatePortalUrl("data:text/plain;base64,SGVsbG8=", true).ok).toBe(false);
  });

  it("rejects unparseable URLs", () => {
    expect(validatePortalUrl("portal.einsvisuals.de", false).ok).toBe(false);
    expect(validatePortalUrl("", false).ok).toBe(false);
    expect(validatePortalUrl("not even a url", false).ok).toBe(false);
  });

  it("attack surface: an http URL whose path contains 'localhost' is rejected (not whitelisted)", () => {
    const r = validatePortalUrl(
      "http://evil.example/localhost?redirect=portal.einsvisuals.de",
      true
    );
    expect(r.ok).toBe(false);
  });
});
