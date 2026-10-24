import { z } from "zod";
import source from "./privacy-source.json";
import type { Clinic } from "../types";

/** One sheet per practice; no provider or transfer facts are inferred. */
export const practicePrivacySheetSchema = z.object({
  stand: z.string(),
  rechtstraeger: z.string(),
  anschrift: z.string(),
  email: z.string(),
  telefon: z.string(),
  zielseite: z.string(),
  impressum: z.string(),
  datenschutzbeauftragter: z.string(),
  hostingDatenbank: z.string(),
  emailVersand: z.string(),
  telefonanbieter: z.string(),
  buchungslink: z.string(),
  buchungsanbieter: z.string(),
  buchungsfelder: z.string(),
  kiDienst: z.string(),
  drittlandtransfer: z.string(),
  aufsichtsbehoerde: z.string(),
}).strict();

export type PracticePrivacySheet = z.infer<typeof practicePrivacySheetSchema>;

export const PRACTICE_SHEET_FIELDS: Record<keyof PracticePrivacySheet, string> = {
  stand: "Stand (TT.MM.JJJJ)",
  rechtstraeger: "Rechtsträger der Praxis",
  anschrift: "Vollständige Anschrift",
  email: "E-Mail für Kontakt und Widerruf",
  telefon: "Telefon für direkten Kontakt",
  zielseite: "Adresse der Zielseite (https://…)",
  impressum: "Adresse des eigenen Praxis-Impressums (https://…)",
  datenschutzbeauftragter: "Datenschutzbeauftragter: Name und Kontakt, falls benannt",
  hostingDatenbank: "Hosting und Datenbank: Anbieter, Sitz, Verarbeitungsorte",
  emailVersand: "E-Mail-Versand: Anbieter, Sitz, Verarbeitungsorte",
  telefonanbieter: "Anrufauswertung: Anbieter, Sitz, Verarbeitungsorte; leer ohne Anrufauswertung",
  buchungslink: "Online-Buchungslink; leer ohne Online-Buchung",
  buchungsanbieter: "Terminbuchung: Anbieter, Sitz, Verarbeitungsorte",
  buchungsfelder: "Dort abgefragte Felder",
  kiDienst: "KI-Dienst: Anbieter und Verarbeitungsorte; leer ohne KI",
  drittlandtransfer: "Drittland: Empfänger, Land, konkrete Grundlage; sonst ausdrücklich keine Übermittlung",
  aufsichtsbehoerde: "Zuständige Aufsichtsbehörde mit Kontakt",
};

const required: (keyof PracticePrivacySheet)[] = [
  "stand", "rechtstraeger", "anschrift", "email", "telefon", "zielseite", "impressum",
  "hostingDatenbank", "emailVersand", "drittlandtransfer", "aufsichtsbehoerde",
];

const isPlaceholder = (value: string) => /\[[^\]]*\]|\b(?:TODO|TBD|example\.(?:com|org)|beispiel\.de)\b/i.test(value);
const isHttpsUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !isPlaceholder(value);
  } catch { return false; }
};

export function practicePrivacyProblems(clinic: Pick<Clinic, "slug" | "privacySheet" | "contact" | "connectors" | "domains" | "brand"> & { legal?: Clinic["legal"] }): string[] {
  const parsed = practicePrivacySheetSchema.safeParse(clinic.privacySheet);
  if (!parsed.success) return parsed.error.issues.map((issue) => `privacySheet.${issue.path.join(".")}: ${issue.message}`);
  const s = parsed.data;
  const problems: string[] = [];
  for (const key of required) if (!s[key].trim()) problems.push(`privacySheet.${key}: missing`);
  for (const [key, value] of Object.entries(s)) if (isPlaceholder(value)) problems.push(`privacySheet.${key}: unresolved placeholder`);
  for (const key of ["zielseite", "impressum", "buchungslink"] as const) {
    if (s[key] && !isHttpsUrl(s[key])) problems.push(`privacySheet.${key}: HTTPS URL required`);
  }
  if (s.stand) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.stand);
    const date = match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`) : null;
    if (!match || !date || Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2])) problems.push("privacySheet.stand: valid DD.MM.YYYY required");
  }
  if (!z.string().email().safeParse(s.email).success) problems.push("privacySheet.email: valid email required");
  if (s.email !== clinic.contact.email) problems.push("privacySheet.email: differs from practice contact");
  if (s.telefon.replace(/\D/g, "") !== clinic.contact.phoneE164.replace(/\D/g, "")) problems.push("privacySheet.telefon: differs from practice contact");
  if ((s.buchungslink || "") !== (clinic.contact.bookingUrl || "")) problems.push("privacySheet.buchungslink: differs from configured booking URL");
  if (s.buchungslink && (!s.buchungsanbieter.trim() || !s.buchungsfelder.trim())) problems.push("privacySheet: booking provider and fields required");
  if (!s.buchungslink && (s.buchungsanbieter || s.buchungsfelder)) problems.push("privacySheet: booking details require a booking URL");
  if (isHttpsUrl(s.zielseite) && !clinic.domains.includes(new URL(s.zielseite).hostname)) problems.push("privacySheet.zielseite: host is not registered for this practice");
  if (s.kiDienst) problems.push("privacySheet.kiDienst: the form has no separate AI consent; keep AI disabled");
  if (clinic.connectors.metaPixelId || clinic.connectors.googleAdsId || clinic.connectors.tiktokPixelId) problems.push("Final 14 declares no advertising or analytics cookies; configured pixels need a revised approved notice");
  if (clinic.brand.googleFontsUrl) problems.push("Final 14 does not name external font recipients; use the local fonts");
  if (practiceLegalLinks(clinic).imprint === `/${clinic.slug}/impressum` && (!clinic.legal || isPlaceholder(JSON.stringify(clinic.legal)))) problems.push("The local practice imprint needs complete clinic.legal details");
  return problems;
}

export function practiceLegalLinks(clinic: Pick<Clinic, "slug" | "privacySheet"> & { domains?: string[] }) {
  const localImprint = `/${clinic.slug}/impressum`;
  let imprint = clinic.privacySheet.impressum.trim() || localImprint;
  if (isHttpsUrl(imprint)) {
    const url = new URL(imprint);
    const path = url.pathname.replace(/\/$/, "");
    // A practice may use the generated imprint on its own landing domain.
    // Normalize that destination so the imprint route never redirects to itself.
    if (clinic.domains?.includes(url.hostname) && (path === "/impressum" || path === localImprint)) imprint = localImprint;
  }
  return {
    privacy: `/${clinic.slug}/datenschutz`,
    imprint,
  };
}

export function renderPracticePrivacy(s: PracticePrivacySheet): string {
  const field = (key: keyof PracticePrivacySheet) => s[key].trim() || `[${PRACTICE_SHEET_FIELDS[key]}]`;
  const blocks = source.markdown.split(/\n\n+/).flatMap((original) => {
    let block = original;
    if (block.startsWith("Diese Information gilt")) {
      const routes = [`die Zielseite ${field("zielseite")}`];
      if (s.telefonanbieter) routes.push(`die Telefonnummer ${field("telefon")}`);
      if (s.buchungslink) routes.push(`den Buchungslink ${s.buchungslink}`);
      return [`Diese Information gilt für Anfragen über ${routes.join(" und ")}. Stand: ${field("stand")}.`];
    }
    if (block.startsWith("Die Telefonnummer [Nummer]")) {
      if (!s.telefonanbieter) return [];
      block = block.replace("[Anbieter, Sitz, Verarbeitungsort]", s.telefonanbieter);
    }
    if (block.startsWith("Für Online-Termine nutzen wir")) {
      if (!s.buchungslink) return [];
      block = block.replace("[Anbieter, Sitz, Verarbeitungsort]", field("buchungsanbieter")).replace("[Felder]", field("buchungsfelder"));
    }
    if (block.startsWith("[Nur bei Einsatz eines KI-Dienstes:]")) {
      if (!s.kiDienst) return [];
      block = block.replace("[Nur bei Einsatz eines KI-Dienstes:] ", "").replace("[KI-Dienst, Anbieter, Verarbeitungsort]", s.kiDienst);
    }
    if (block.startsWith("Empfänger Ihrer Angaben sind:")) {
      const recipients = [`Hosting und Datenbank ${field("hostingDatenbank")}`, `E-Mail-Versand ${field("emailVersand")}`];
      if (s.telefonanbieter) recipients.push(`Telefonie ${s.telefonanbieter}`);
      if (s.buchungslink) recipients.push(`Terminbuchung ${field("buchungsanbieter")}`);
      if (s.kiDienst) recipients.push(`KI-Dienst ${s.kiDienst}`);
      return [`Empfänger Ihrer Angaben sind: ${recipients.join(", ")} und EINS. Alle arbeiten für uns nach Weisung und sind zur Verschwiegenheit verpflichtet. ${field("drittlandtransfer")}`];
    }
    const replacements: Record<string, string> = {
      "[Rechtsträger der Praxis, Anschrift]": `${field("rechtstraeger")}, ${field("anschrift")}`,
      "[E-Mail]": field("email"), "[Telefon]": field("telefon"), "[Nummer]": field("telefon"),
      "[Kontakt]": field("email"), "[Behörde, Kontakt]": field("aufsichtsbehoerde"),
      "[Datenschutzbeauftragter mit Kontakt, nur wenn benannt.]": s.datenschutzbeauftragter ? `Datenschutzbeauftragter: ${s.datenschutzbeauftragter}` : "",
    };
    // One pass: values are literal text and cannot be interpreted as further template tokens.
    block = block.replace(/\[[^\]]+\]/g, (token) => replacements[token] ?? token);
    if (!s.telefonanbieter) block = block.replace("Grundlage für Telefon und Herkunft", "Grundlage für die Herkunft");
    return [block.trim()];
  });
  return blocks.join("\n\n");
}
