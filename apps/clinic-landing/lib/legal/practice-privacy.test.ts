import assert from "node:assert/strict";
import test from "node:test";
import source from "./privacy-source.json";
import sheetTemplate from "../../clinics/_template/privacy-sheet.json";
import { practiceLegalLinks, practicePrivacyProblems, renderPracticePrivacy, type PracticePrivacySheet } from "./practice-privacy";
import { healthConsentText } from "./health-consent";

// Fictional data used only by tests, never registered or exported as a practice.
const sheet: PracticePrivacySheet = {
  ...sheetTemplate,
  stand: "11.10.2026", rechtstraeger: "Testpraxis A GmbH", anschrift: "Teststrasse 1, 12345 Teststadt",
  email: "datenschutz@praxis.test", telefon: "+49 30 12345678",
  zielseite: "https://praxis.test/", impressum: "https://praxis.test/angaben",
  hostingDatenbank: "Testhost GmbH, Deutschland", emailVersand: "Testmail GmbH, Deutschland",
  drittlandtransfer: "Wir übermitteln keine Angaben in ein Drittland.",
  aufsichtsbehoerde: "Testbehörde, https://behoerde.test/",
};
const clinic = {
  slug: "praxis-a", privacySheet: sheet,
  contact: { email: sheet.email, phoneE164: "+493012345678", phoneDisplay: sheet.telefon },
  domains: ["praxis.test"], connectors: {}, brand: {} as never,
};

test("the form uses the exact consent paragraph published in Final 14", () => {
  assert.ok(renderPracticePrivacy(sheet).includes(`[ ] ${healthConsentText(sheet.email)}`));
  assert.doesNotMatch(healthConsentText(sheet.email), /\[Kontakt\]/);
});

test("fills every required Final 14 token and retains each non-optional section", () => {
  const text = renderPracticePrivacy(sheet);
  assert.deepEqual(practicePrivacyProblems(clinic), []);
  assert.doesNotMatch(text.replaceAll("[ ]", ""), /\[[^\]]*\]/);
  for (const heading of source.markdown.match(/^## .+$/gm) ?? []) assert.ok(text.includes(heading), heading);
  for (const paragraph of ["Ihre Anfrage ist keine Einwilligung in Newsletter oder Werbung.", "Wir geben keine Angaben aus Ihrer Anfrage an Werbeplattformen weiter.", "Wir speichern Ihre Anfrage, bis sie erledigt ist, und löschen sie spätestens sechs Monate danach."]) assert.ok(text.includes(paragraph));
  assert.ok(text.includes(sheet.rechtstraeger));
  assert.ok(text.includes(sheet.aufsichtsbehoerde));
  assert.doesNotMatch(text, /Telefonanbieter:|Für Online-Termine|Ein KI-Dienst liest/);
});

test("optional provider blocks are included only for the configured services", () => {
  const active = { ...sheet, telefonanbieter: "Testtel, Deutschland", buchungslink: "https://termine.test/", buchungsanbieter: "Testtermine, Deutschland", buchungsfelder: "Name und Kontakt", kiDienst: "Test-KI, Deutschland", datenschutzbeauftragter: "Test DSB, dsb@praxis.test" };
  const text = renderPracticePrivacy(active);
  for (const value of [active.telefonanbieter, active.buchungslink, active.buchungsanbieter, active.buchungsfelder, active.kiDienst, active.datenschutzbeauftragter]) assert.ok(text.includes(value));
  assert.doesNotMatch(text.replaceAll("[ ]", ""), /\[[^\]]*\]/);
  assert.ok(practicePrivacyProblems({ ...clinic, privacySheet: active }).some((problem) => problem.includes("AI consent")));
});

test("missing or copied template data blocks a real practice, including optional fields", () => {
  assert.ok(practicePrivacyProblems({ ...clinic, privacySheet: sheetTemplate }).length > 0);
  for (const key of ["rechtstraeger", "impressum", "hostingDatenbank", "drittlandtransfer", "aufsichtsbehoerde"] as const) {
    assert.ok(practicePrivacyProblems({ ...clinic, privacySheet: { ...sheet, [key]: "" } }).length > 0, key);
  }
  assert.ok(practicePrivacyProblems({ ...clinic, privacySheet: { ...sheet, datenschutzbeauftragter: "[Name]" } }).length > 0);
});

test("detects mismatched contact, domain, booking, invalid dates and incompatible pixels", () => {
  for (const patch of [{ email: "wrong@praxis.test" }, { telefon: "+49 30 11111111" }, { zielseite: "https://other.test/" }, { buchungslink: "https://termine.test/" }, { stand: "31.02.2026" }, { impressum: "javascript:alert(1)" }]) {
    assert.ok(practicePrivacyProblems({ ...clinic, privacySheet: { ...sheet, ...patch } }).length > 0, JSON.stringify(patch));
  }
  assert.ok(practicePrivacyProblems({ ...clinic, connectors: { metaPixelId: "123" } }).some((problem) => problem.includes("cookies")));
});

test("footer links stay with their practice on both start and treatment pages", () => {
  assert.deepEqual(practiceLegalLinks(clinic), { privacy: "/praxis-a/datenschutz", imprint: sheet.impressum });
  const second = { slug: "praxis-b", privacySheet: { ...sheet, impressum: "https://b.test/impressum" } };
  assert.deepEqual(practiceLegalLinks(second), { privacy: "/praxis-b/datenschutz", imprint: "https://b.test/impressum" });
  for (const current of ["https://preview.test/praxis-a", "https://preview.test/praxis-a/a1", "https://praxis.test/a1"]) {
    assert.equal(new URL(practiceLegalLinks(clinic).privacy, current).pathname, "/praxis-a/datenschutz");
  }
});

test("an imprint on the landing domain resolves locally without a redirect loop", () => {
  for (const path of ["/impressum", "/impressum/", "/praxis-a/impressum"]) {
    const local = { ...clinic, privacySheet: { ...sheet, impressum: `https://praxis.test${path}` } };
    assert.equal(practiceLegalLinks(local).imprint, "/praxis-a/impressum");
    assert.ok(practicePrivacyProblems(local).some((problem) => problem.includes("clinic.legal")));
  }
});
