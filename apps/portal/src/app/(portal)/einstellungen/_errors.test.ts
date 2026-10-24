import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SettingsUserError, parseSettingsInput, settingsErrorMessage } from "./_errors";

afterEach(() => vi.restoreAllMocks());

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

describe("parseSettingsInput (F-02)", () => {
  const schema = z.object({
    email: z.string().email(),
    fullName: z.string().min(1),
    reviewRequestDelayDays: z.coerce.number().int().min(0).max(60),
  });

  it("returns parsed data on success", () => {
    expect(
      parseSettingsInput(schema, { email: "a@b.de", fullName: "Dr. Muster", reviewRequestDelayDays: "3" })
    ).toEqual({ email: "a@b.de", fullName: "Dr. Muster", reviewRequestDelayDays: 3 });
  });

  it("throws a German SettingsUserError naming the field", () => {
    const err = caught(() =>
      parseSettingsInput(schema, { email: "kein-at", fullName: "x", reviewRequestDelayDays: 1 })
    );
    expect(err).toBeInstanceOf(SettingsUserError);
    expect((err as Error).message).toBe(
      "Bitte geben Sie bei „E-Mail-Adresse“ eine gültige E-Mail-Adresse ein."
    );

    const missing = caught(() =>
      parseSettingsInput(schema, { email: "a@b.de", reviewRequestDelayDays: 1 })
    ) as Error;
    expect(missing.message).toBe("Bitte füllen Sie das Feld „Name“ aus.");

    const big = caught(() =>
      parseSettingsInput(schema, { email: "a@b.de", fullName: "x", reviewRequestDelayDays: 99 })
    ) as Error;
    expect(big.message).toBe("Der Wert bei „Wartezeit in Tagen“ ist zu groß oder zu lang.");
  });

  it("keeps messages written in the schema", () => {
    const s = z.object({ name: z.string().min(2, "Bitte mindestens 2 Zeichen.") });
    expect((caught(() => parseSettingsInput(s, { name: "a" })) as Error).message).toBe(
      "Bitte mindestens 2 Zeichen."
    );
  });

  it("never leaks zod's English default text", () => {
    const s = z.object({ role: z.enum(["inhaber", "mitarbeiter"]) });
    const msg = (caught(() => parseSettingsInput(s, { role: "root" })) as Error).message;
    expect(msg).toBe("Bitte wählen Sie bei „Rolle“ einen gültigen Wert.");
    expect(msg).not.toMatch(/Invalid|Expected|Required/);
  });
});

describe("settingsErrorMessage (F-02)", () => {
  it("shows SettingsUserError text verbatim", () => {
    expect(settingsErrorMessage(new SettingsUserError("Diese Person ist bereits im Team."), "x")).toBe(
      "Diese Person ist bereits im Team."
    );
  });

  it("maps a unique violation (also wrapped in cause) to a German message", () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
      code: "23505",
    });
    expect(settingsErrorMessage(pg, "settings.treatment")).toBe("Dieser Eintrag existiert bereits.");
    const wrapped = new Error("Failed query: insert into treatments ...", { cause: pg });
    expect(settingsErrorMessage(wrapped, "settings.treatment")).toBe("Dieser Eintrag existiert bereits.");
  });

  it("never shows raw driver text and logs without it reaching the toast", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pg = Object.assign(new Error('relation "treatments" does not exist'), { code: "42P01" });
    const msg = settingsErrorMessage(pg, "settings.treatment");
    expect(msg).not.toContain("relation");
    expect(msg).not.toContain("treatments");
    expect(log).toHaveBeenCalled();
  });

  it("re-throws Next control-flow errors (redirect)", () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    expect(() => settingsErrorMessage(redirectErr, "x")).toThrow("NEXT_REDIRECT");
  });
});
