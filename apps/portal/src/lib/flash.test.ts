import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const { flashMessageFromError } = await import("./flash");
const { ForbiddenError } = await import("./roles");
const { ImpersonationBlockedError } = await import("@/auth/impersonation-guard");
const { describeErrorForLog, scrubMessage } = await import("./error-log");
const { EmailDeliveryError } = await import("./email-delivery-error");

function pgError() {
  // Shape of a postgres.js PostgresError for a unique violation.
  const e = new Error('duplicate key value violates unique constraint "clinic_users_email_key"');
  Object.assign(e, {
    name: "PostgresError",
    severity: "ERROR",
    code: "23505",
    detail: "Key (email)=(patientin@example.de) already exists.",
    constraint_name: "clinic_users_email_key",
    table_name: "clinic_users",
  });
  return e;
}

afterEach(() => vi.restoreAllMocks());

describe("flashMessageFromError", () => {
  it("passes our own German messages through", () => {
    expect(flashMessageFromError(new Error("Diese E-Mail-Adresse ist bereits eingetragen."))).toBe(
      "Diese E-Mail-Adresse ist bereits eingetragen."
    );
    expect(flashMessageFromError(new ImpersonationBlockedError("password"))).toMatch(/Passwort/);
  });

  it("maps driver, zod, forbidden and system errors to German text and logs safely", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const generic = "Das hat gerade nicht geklappt. Bitte versuchen Sie es erneut.";
    expect(flashMessageFromError(pgError(), "invite")).toBe(generic);
    expect(flashMessageFromError(new TypeError("fetch failed"))).toBe(generic);
    expect(flashMessageFromError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(generic);
    expect(flashMessageFromError("weird")).toBe(generic);
    expect(flashMessageFromError(new ForbiddenError("settings.team"))).toBe(
      "Dafür fehlt Ihrer Rolle die Berechtigung."
    );
    const zerr = z.string().email().safeParse("x").error!;
    expect(flashMessageFromError(zerr)).toBe("Bitte prüfen Sie Ihre Eingaben.");

    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toContain('"action":"invite"');
    expect(lines[0]).toContain('"code":"23505"');
    for (const l of lines) {
      expect(l).not.toContain("patientin@example.de");
      expect(l).not.toContain("duplicate key");
    }
  });
});

describe("flashMessageFromError with e-mail delivery failures (V4 Neben 6)", () => {
  it("never shows EmailDeliveryError text, but keeps plain German errors", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const generic = "Das hat gerade nicht geklappt. Bitte versuchen Sie es erneut.";
    expect(
      flashMessageFromError(new EmailDeliveryError("Resend send failed: domain not verified"), "invite")
    ).toBe(generic);
    expect(
      flashMessageFromError(new EmailDeliveryError("Email provider not configured: RESEND_API_KEY missing"))
    ).toBe(generic);
    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain('"name":"EmailDeliveryError"');
    expect(flashMessageFromError(new Error("Diese Behandlung wurde nicht gefunden."))).toBe(
      "Diese Behandlung wurde nicht gefunden."
    );
  });
});

describe("describeErrorForLog", () => {
  it("never carries Postgres message/detail", () => {
    expect(describeErrorForLog(pgError())).toEqual({
      name: "PostgresError",
      code: "23505",
      constraint: "clinic_users_email_key",
      table: "clinic_users",
    });
  });

  it("scrubs e-mails and phone numbers from other messages", () => {
    expect(scrubMessage("send to a.b@praxis.de failed, tel +49 211 1234567")).toBe(
      "send to <email> failed, tel <number>"
    );
  });

  it("follows cause chains", () => {
    const e = new Error("outer", { cause: pgError() });
    expect(describeErrorForLog(e).cause?.code).toBe("23505");
  });
});
