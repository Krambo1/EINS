import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V4 Neben 6: delivery failures of the real senders are `EmailDeliveryError`s,
 * so a server action that lets one reach `flashMessageFromError` shows the
 * Praxis the generic German text, never "Resend send failed: ..." or
 * "Email provider not configured: ...".
 */
const h = vi.hoisted(() => ({
  env: {
    NODE_ENV: "production",
    EMAIL_DRIVER: "resend",
    EMAIL_FROM: "EINS <team@eins.ag>",
    EMAIL_REPLY_TO: "team@eins.ag",
    RESEND_API_KEY: "re_test_dummy",
  } as Record<string, string | undefined>,
  hasResend: true,
}));

vi.mock("@/lib/env", () => ({
  env: h.env,
  hasResend: () => h.hasResend,
  emailLogoUrl: () => "https://portal.example.test/logo.png",
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ error: { message: "The eins.ag domain is not verified" } }),
    };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const GENERIC = "Das hat gerade nicht geklappt. Bitte versuchen Sie es erneut.";
const input = { to: "inhaber@praxis.de", subject: "Test", html: "<p>x</p>", text: "x" };

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("e-mail delivery errors stay internal", () => {
  it("Resend error result: EmailDeliveryError, generic text for the Praxis", async () => {
    h.hasResend = true;
    const { getEmailSender, EmailDeliveryError } = await import("./email");
    const { flashMessageFromError } = await import("@/lib/flash");
    const err = await getEmailSender().send(input).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect((err as Error).message).toContain("Resend send failed");
    expect(flashMessageFromError(err, "test.send")).toBe(GENERIC);
  });

  it("no provider in production: EmailDeliveryError, generic text for the Praxis", async () => {
    h.hasResend = false;
    const { getEmailSender, EmailDeliveryError } = await import("./email");
    const { flashMessageFromError } = await import("@/lib/flash");
    const err = await getEmailSender().send(input).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect((err as Error).message).toContain("Email provider not configured");
    expect(flashMessageFromError(err, "test.send")).toBe(GENERIC);
  });
});
