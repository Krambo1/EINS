import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z, type ZodErrorMap, type ZodTypeAny } from "zod";
import { flashMessageFromError } from "@/lib/flash";

/**
 * Error text for the Einstellungen toasts (F-02).
 *
 * Toasts show only messages written for the Praxis. Input errors come from
 * `parseSettingsInput`, which turns a failed zod parse into a German
 * `SettingsUserError` (schema messages, or the German error map below, with
 * the field name). A unique-constraint violation becomes "existiert bereits".
 * Everything else goes through `flashMessageFromError` (lib/flash.ts): known
 * user-facing errors pass, the rest becomes a generic German message and the
 * details are logged without row values.
 *
 * Next's redirect / notFound control-flow errors (e.g. `requireSession()` on
 * an expired session inside a try block) are re-thrown, never shown as text.
 */

/** A message written for the Praxis; shown verbatim in the toast. */
export class SettingsUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsUserError";
  }
}

/** German labels for form fields used in the Einstellungen actions. */
const FIELD_LABELS: Record<string, string> = {
  email: "E-Mail-Adresse",
  fullName: "Name",
  role: "Rolle",
  displayName: "Praxisname",
  hwgContactName: "HWG-Ansprechpartner",
  hwgContactEmail: "HWG-E-Mail",
  defaultDoctorEmail: "E-Mail der Ärztin oder des Arztes",
  name: "Name",
  keywords: "Stichwörter",
  address: "Adresse",
  reviewRequestDelayDays: "Wartezeit in Tagen",
  googleReviewUrl: "Google-Bewertungslink",
  jamedaReviewUrl: "Jameda-Bewertungslink",
  reviewLandingOrigin: "Adresse der Bewertungsseite",
  reviewInboxEmail: "E-Mail für Rückmeldungen",
  googlePlaceId: "Google Place-ID",
  jamedaProfileUrl: "Jameda-Profil",
  platform: "Plattform",
};

function fieldLabel(path: (string | number)[]): string {
  const key = path.length > 0 ? String(path[path.length - 1]) : "";
  return FIELD_LABELS[key] ?? "Eingabe";
}

/** German messages for zod's built-in checks (zod 3). */
export const germanZodErrorMap: ZodErrorMap = (issue) => {
  const label = fieldLabel(issue.path);
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return {
        message:
          issue.received === "undefined" || issue.received === "null"
            ? `Bitte füllen Sie das Feld „${label}“ aus.`
            : `Das Feld „${label}“ hat ein ungültiges Format.`,
      };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") {
        return { message: `Bitte geben Sie bei „${label}“ eine gültige E-Mail-Adresse ein.` };
      }
      if (issue.validation === "url") {
        return { message: `Bitte geben Sie bei „${label}“ eine vollständige Adresse (https://…) ein.` };
      }
      return { message: `Das Feld „${label}“ hat ein ungültiges Format.` };
    case z.ZodIssueCode.too_small:
      return {
        message:
          issue.type === "string" && Number(issue.minimum) <= 1
            ? `Bitte füllen Sie das Feld „${label}“ aus.`
            : `Der Wert bei „${label}“ ist zu klein oder zu kurz.`,
      };
    case z.ZodIssueCode.too_big:
      return { message: `Der Wert bei „${label}“ ist zu groß oder zu lang.` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Bitte wählen Sie bei „${label}“ einen gültigen Wert.` };
    default:
      return { message: `Bitte prüfen Sie das Feld „${label}“.` };
  }
};

/** Parse form input; on failure throw a German SettingsUserError. */
export function parseSettingsInput<S extends ZodTypeAny>(
  schema: S,
  data: unknown
): z.output<S> {
  const result = schema.safeParse(data, { errorMap: germanZodErrorMap });
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw new SettingsUserError(first?.message ?? "Bitte prüfen Sie Ihre Eingaben.");
}

function sqlState(err: unknown): string | null {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** Toast description for a caught error in an Einstellungen action. */
export function settingsErrorMessage(err: unknown, action: string): string {
  unstable_rethrow(err);
  if (err instanceof SettingsUserError) return err.message;
  if (sqlState(err) === "23505") return "Dieser Eintrag existiert bereits.";
  return flashMessageFromError(err, action);
}
