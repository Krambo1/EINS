/**
 * Asset-Liefer-Checkliste - item catalog (Kunden-Onboarding Teil 2).
 *
 * Source of truth for the content: Obsidian note "Asset-Liefer-Checkliste
 * (Kunden-Onboarding)" (10 EINS/Kunden/), Blocks A-F, mirrored in
 * docs/asset-checkliste/checkliste-v1.md. This file is the contract the DB
 * schema (checklist_items / checklist_files), the clinic page, the admin tab
 * and the PDF all build on.
 *
 * Item ids ("A1".."F6") are a STORAGE CONTRACT: they key the per-item rows and
 * the storage paths. Never renumber an existing item; only append. Unknown ids
 * in stored rows are ignored by the page, the admin tab and the actions, so an
 * item can be retired by removing it here; a retired id is never reused.
 * Retired: F1 (Patienten-Einwilligungen fuer den Produktionstag), retired on
 * 2026-09-30 with the switch to the KI-Klon. Successor: F5.
 * Retired: D5 (Vorher-Nachher-Material), retired on 2026-09-30: Vorher-Nachher
 * is not used at all (KANON Abschnitt 8, § 3 und § 11 HWG). No successor.
 *
 * Lieferweg-Typen (see DeliveryType): how each item is delivered and what sets
 * its status to 'geliefert'. Two-stage everywhere: the clinic delivers, EINS
 * confirms 'geprueft' in the admin.
 */

// ---------------------------------------------------------------
// EINS recipient data referenced in the step-by-step instructions.
// TODO(karam): replace these three placeholders with the real values before
// go-live (the {{...}} originals are listed in docs/asset-checkliste/checkliste-v1.md).
// ---------------------------------------------------------------
export const EINS_CONTACT = {
  /** EINS Business-Manager-ID for the Meta partner invite (B1). */
  metaBmId: "(Ihre EINS-Business-Manager-ID nennen wir Ihnen im Onboarding)",
  /** E-mail address clinics invite for Google Ads / GBP / Analytics / CMS. */
  adsEmail: "(diese E-Mail-Adresse nennen wir Ihnen im Onboarding)",
  /** Fallback contact for questions about uploads. */
  uploadKontakt: "Ihre EINS-Ansprechperson",
} as const;

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export type DeliveryType =
  | "einladung"
  | "upload"
  | "link"
  | "upload_oder_link"
  | "angabe"
  | "status";

/** Who may close an item. `team` = any clinic role with write access. */
export type ItemRole = "inhaber" | "team";

export type ChecklistStatus = "offen" | "geliefert" | "geprueft" | "entfaellt";

/** Upload allowlist profile - drives the file picker `accept` and the
 *  server-side extension check. Keys map into UPLOAD_PROFILES. */
export type UploadProfile = "logo" | "dokument" | "bild";

export interface AngabeField {
  /** Key under which the value is stored in checklist_items.answer. */
  key: string;
  label: string;
  type: "text" | "textarea";
  placeholder?: string;
  optional?: boolean;
  /**
   * Semantic format marker. Drives the input type/inputMode on the client and
   * the value validation on the server (source of truth). Only single-line
   * `text` fields carry this; freeform textareas stay unvalidated.
   */
  format?: "email" | "tel";
}

export interface ChecklistItem {
  /** "A1".."F6" - storage contract, never renumber, never reuse a retired id. */
  id: string;
  title: string;
  deliveryType: DeliveryType;
  /** Pflicht: counts toward onboarding completion. */
  required: boolean;
  /** Block A: counts for the Leistungsstart only once 'geprueft'. */
  blocker: boolean;
  role: ItemRole;
  /** Softer than Pflicht (Block D "Empfohlen"): surfaced, not blocking. */
  recommended?: boolean;
  /** Step-by-step delivery instruction. May contain newlines. */
  anleitung: string;
  /** Optional "Warum wir das brauchen". */
  warum?: string;
  /** Structured text fields (angabe items, plus extras on some einladung items). */
  fields?: AngabeField[];
  /** Upload items: which file types are accepted. */
  uploadProfile?: UploadProfile;
  /** einladung/B-items where "nicht vorhanden" is a valid answer (-> entfaellt). */
  allowNichtVorhanden?: boolean;
  /** F2: "Keine vorhanden" is a valid complete answer (-> geliefert). */
  allowKeineVorhanden?: boolean;
}

export interface ChecklistBlock {
  /** "A".."F". */
  key: string;
  title: string;
  /** Optional standing note above the whole block (e.g. Block B passwords). */
  intro?: string;
  items: ChecklistItem[];
}

// ---------------------------------------------------------------
// Upload profiles
// ---------------------------------------------------------------

export const UPLOAD_PROFILES: Record<
  UploadProfile,
  { accept: string; extensions: string[]; hint: string }
> = {
  logo: {
    accept: ".svg,.eps,.ai,.pdf,.png,image/svg+xml,application/pdf,image/png",
    extensions: ["svg", "eps", "ai", "pdf", "png"],
    hint: "SVG, EPS, AI, PDF oder PNG",
  },
  dokument: {
    accept: ".pdf,image/*,application/pdf",
    extensions: ["pdf", "png", "jpg", "jpeg", "webp", "heic", "heif"],
    hint: "PDF oder Foto/Scan",
  },
  bild: {
    accept: "image/*,.pdf,application/pdf",
    extensions: ["png", "jpg", "jpeg", "webp", "heic", "heif", "pdf"],
    hint: "Bilder (JPG, PNG, WebP) oder PDF",
  },
};

/** Hard cap per uploaded file. Videos go via link (D4), so 25 MB is plenty. */
export const MAX_CHECKLIST_UPLOAD_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------

export const CHECKLIST_BLOCKS: ChecklistBlock[] = [
  {
    key: "A",
    title: "Grundlagen zum Start: Ohne diese Punkte startet nichts",
    intro:
      "Diese fünf Punkte brauchen wir, bevor die Leistung startet. Die Klon-Aufnahme und die Einwilligung brauchen wir innerhalb von 3 Werktagen nach Unterschrift. Sie zählen erst als erledigt, sobald wir sie geprüft haben.",
    items: [
      {
        id: "A1",
        title: "Unterschriebener Auftragsverarbeitungsvertrag (AVV)",
        deliveryType: "upload",
        uploadProfile: "dokument",
        required: true,
        blocker: true,
        role: "inhaber",
        anleitung:
          'Den AVV stellt EINS bereit: Sie finden ihn im Portal unter Dokumente, Kategorie "Auftragsverarbeitungsvertrag". Bitte ausdrucken oder digital signieren, von der vertretungsberechtigten Person unterschreiben lassen und die unterschriebene Fassung hier als PDF hochladen.',
        warum:
          "Ohne unterschriebenen AVV dürfen wir keine personenbezogenen Daten für Sie verarbeiten; die Leistungserbringung startet erst danach (Hauptvertrag § 3 Abs. 3).",
      },
      {
        id: "A2",
        title: "Ansprechpartner mit Entscheidungsbefugnis",
        deliveryType: "angabe",
        required: true,
        blocker: true,
        role: "team",
        anleitung:
          "Nennen Sie die Person, die im Alltag Entscheidungen für die Zusammenarbeit treffen darf (Freigaben, Rückfragen). Das kann der Inhaber selbst sein oder eine bevollmächtigte Person.",
        warum:
          "Jede Rückfrage, die erst durch die Praxis wandern muss, kostet Zeit.",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "funktion", label: "Funktion", type: "text" },
          { key: "handy", label: "Handynummer", type: "text", format: "tel" },
          { key: "email", label: "E-Mail", type: "text", format: "email" },
          {
            key: "kanal",
            label: "Bevorzugter Kanal",
            type: "text",
            placeholder: "Telefon / E-Mail / WhatsApp",
          },
        ],
      },
      {
        id: "A3",
        title: "Ärztliche Leitung als fachliche Ansprechperson",
        deliveryType: "angabe",
        required: true,
        blocker: true,
        role: "team",
        anleitung:
          "Die ärztliche Leitung gibt medizinische Aussagen in Beiträgen, Anzeigen und auf Zielseiten frei (Heilmittelwerbegesetz). Bitte nennen Sie die zuständige Ärztin oder den zuständigen Arzt.",
        warum:
          "Werbliche Aussagen über Behandlungen dürfen nur mit fachlicher Freigabe live gehen.",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "titel", label: "Titel", type: "text" },
          { key: "email", label: "E-Mail", type: "text", format: "email" },
          {
            key: "telefon",
            label: "Telefonnummer",
            type: "text",
            optional: true,
            format: "tel",
          },
        ],
      },
      {
        id: "A4",
        title: "Termin für das Onboarding-Gespräch bestätigt",
        deliveryType: "status",
        required: true,
        blocker: true,
        role: "team",
        anleitung:
          "Das Onboarding-Gespräch dauert etwa 90 Minuten und findet per Video statt. Den Termin stimmen Sie direkt mit Ihrem EINS-Ansprechpartner ab. Haken Sie diesen Punkt ab, sobald der Termin in beiden Kalendern steht.",
      },
      {
        // The id A5 stays (storage contract); only label and help text changed
        // on 2026-09-30 (was: Termin fuer den Produktionstag fixiert).
        // TODO(karam): Uebergabeweg der Klon-Aufnahme festlegen (Portal-Upload,
        // Link oder Uebergabe im Onboarding-Gespraech); haengt an der Wahl des
        // KI-Werkzeugs. Bis dahin nennt der Text keinen Weg.
        id: "A5",
        title: "Klon-Aufnahme und Einwilligung geliefert",
        deliveryType: "status",
        required: true,
        blocker: true,
        role: "team",
        anleitung:
          "Sie nehmen einmal wenige Minuten Video und Stimme mit dem Handy auf, nach der Anleitung von EINS. Daraus entsteht Ihr KI-Klon. Dazu gehört Ihre unterschriebene Einwilligung für KI-Abbild und Stimme, die Sie unter Punkt F5 hochladen. Haken Sie ab, sobald beides an EINS übergeben ist. Frist: 3 Werktage nach Unterschrift.",
        warum:
          "Ohne Klon-Aufnahme und Einwilligung startet die Leistung nicht.",
      },
    ],
  },
  {
    key: "B",
    title: "Zugänge zu Werbekonten und Plattformen",
    intro:
      "Alle Zugänge per Einladung oder Partnerfreigabe an EINS. Bitte niemals Passwörter per E-Mail oder Telefon weitergeben, wir fragen auch nie danach. Frist für Instagram, Facebook, Meta Business Manager und die Domain: 3 Werktage nach Unterschrift.",
    items: [
      {
        id: "B1",
        title: "Meta Business Manager: Partnerzugriff",
        deliveryType: "einladung",
        required: true,
        blocker: false,
        role: "team",
        allowNichtVorhanden: true,
        anleitung: `1. Öffnen Sie business.facebook.com und melden Sie sich an.
2. Klicken Sie links unten auf das Zahnrad (Einstellungen), dann auf "Unternehmenseinstellungen".
3. Wählen Sie links "Nutzer", dann "Partner".
4. Klicken Sie auf "Hinzufügen" und wählen Sie "Einen Partner einladen, der deine Assets verwaltet" (Wortlaut kann je nach Meta-Version leicht abweichen).
5. Geben Sie die EINS Business-Manager-ID ein: ${EINS_CONTACT.metaBmId}
6. Haken Sie hier "Einladung verschickt" ab.

Falls Ihre Praxis keinen Business Manager hat: Wählen Sie "Nicht vorhanden". Wir legen ihn im Onboarding-Gespräch gemeinsam an, das dauert etwa 15 Minuten.`,
      },
      {
        id: "B2",
        title: "Facebook-Seite und Instagram-Konto: Vollzugriff",
        deliveryType: "einladung",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          'Im selben Bereich ("Unternehmenseinstellungen" im Business Manager): Ordnen Sie EINS als Partner Ihre Facebook-Seite und Ihr Instagram-Konto mit voller Kontrolle bzw. Admin-Zugriff zu ("Konten" → "Seiten" / "Instagram-Konten" → Asset auswählen → "Partner zuweisen"). Falls Ihr Instagram-Konto noch nicht mit dem Business Manager verbunden ist, verbinden Sie es dort unter "Konten" → "Instagram-Konten" → "Hinzufügen".',
      },
      {
        id: "B3",
        title: "Meta-Werbekonto: Zugriff und Zahlungsmittel",
        deliveryType: "einladung",
        required: true,
        blocker: false,
        role: "team",
        allowNichtVorhanden: true,
        anleitung: `1. Weisen Sie EINS Ihr Werbekonto als Partner zu ("Konten" → "Werbekonten" → "Partner zuweisen", Zugriff "Werbekonto verwalten").
2. Hinterlegen Sie ein Zahlungsmittel der Praxis (Kreditkarte oder Lastschrift) unter "Abrechnung und Zahlungen". Das Werbebudget zahlen Sie direkt an Meta, nicht an EINS. Zu Beginn brauchen Sie kein Werbebudget, wir starten organisch.
3. Haken Sie ab, wenn beides erledigt ist.

Falls kein Werbekonto existiert: "Nicht vorhanden" wählen, wir legen es gemeinsam an, sobald Anzeigen dazukommen.`,
      },
      {
        id: "B4",
        title: "Google Ads-Konto: Zugriff",
        deliveryType: "einladung",
        required: true,
        blocker: false,
        role: "team",
        allowNichtVorhanden: true,
        anleitung: `1. Öffnen Sie ads.google.com und melden Sie sich an.
2. Klicken Sie oben rechts auf "Verwaltung" (Werkzeug-Symbol), dann "Zugriff und Sicherheit".
3. Klicken Sie auf das Plus und laden Sie diese E-Mail-Adresse mit Zugriffsebene "Administrator" ein: ${EINS_CONTACT.adsEmail}
4. Haken Sie "Einladung verschickt" ab.

Falls Ihre Praxis kein Google Ads-Konto hat: "Nicht vorhanden" wählen.`,
      },
      {
        id: "B5",
        title: "Google Unternehmensprofil: Verwalterzugriff",
        deliveryType: "einladung",
        required: true,
        blocker: false,
        role: "team",
        anleitung: `1. Öffnen Sie business.google.com und wählen Sie Ihr Praxis-Profil.
2. Gehen Sie zu "Einstellungen" → "Nutzer und Zugriffsrechte" (bzw. Menü → "Profilmanager").
3. Fügen Sie ${EINS_CONTACT.adsEmail} als "Manager" hinzu.`,
        warum:
          "Über das Unternehmensprofil laufen Ihr Bewertungssystem und lokale Anzeigen.",
      },
      {
        id: "B6",
        title: "Google Analytics / Tag Manager",
        deliveryType: "einladung",
        required: false,
        blocker: false,
        role: "team",
        allowNichtVorhanden: true,
        anleitung: `Nur falls vorhanden: Laden Sie ${EINS_CONTACT.adsEmail} in Google Analytics (Verwaltung → Zugriffsverwaltung des Kontos, Rolle "Administrator") und im Tag Manager (Verwaltung → Nutzerverwaltung, "Veröffentlichen") ein. Falls Sie nicht sicher sind, ob es ein Konto gibt: "Nicht vorhanden" wählen, wir prüfen das gemeinsam.`,
      },
    ],
  },
  {
    key: "C",
    title: "Zugänge zu Website und Praxis-Systemen",
    items: [
      {
        id: "C1",
        title: "Website: Zugang zum Redaktionssystem",
        deliveryType: "einladung",
        required: true,
        blocker: false,
        role: "team",
        anleitung: `Legen Sie für EINS einen eigenen Benutzer in Ihrem Redaktionssystem an (bei WordPress: Dashboard → "Benutzer" → "Neu hinzufügen", Rolle "Administrator", E-Mail ${EINS_CONTACT.adsEmail}). Bitte kein bestehendes Passwort weitergeben. Wird Ihre Website extern betreut, reicht der Kontakt zur Agentur, wir klären den Zugang direkt.`,
        fields: [
          {
            key: "agentur",
            label: "Betreuende Agentur / Webmaster",
            type: "text",
            optional: true,
            placeholder: "nur falls extern betreut",
          },
          {
            key: "agenturKontakt",
            label: "Kontakt der Agentur",
            type: "text",
            optional: true,
          },
        ],
      },
      {
        id: "C2",
        title: "Domain / DNS",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Wir brauchen einmalig eine kleine technische Einstellung an Ihrer Domain (für Ihre Zielseiten und die Messung der Anfragen). Tragen Sie ein, wo die Domain liegt und wer sie verwaltet; die Umsetzung übernehmen wir gemeinsam mit dieser Person.",
        fields: [
          {
            key: "anbieter",
            label: "Anbieter",
            type: "text",
            placeholder: "z. B. IONOS, Strato",
          },
          {
            key: "kontakt",
            label: "Verwaltende Person / Agentur",
            type: "text",
          },
        ],
      },
      {
        id: "C3",
        title: "Buchungssystem (z. B. Doctolib)",
        deliveryType: "angabe",
        required: false,
        blocker: false,
        role: "team",
        anleitung:
          'Falls Patienten bei Ihnen online buchen können: Tragen Sie den Buchungslink ein. Wenn Anfragen direkt in Ihren Kalender laufen sollen, vermerken Sie "Integration gewünscht", den Rest klären wir im Onboarding-Gespräch.',
        fields: [
          { key: "system", label: "System", type: "text" },
          { key: "buchungslink", label: "Buchungslink", type: "text" },
          {
            key: "integration",
            label: "Integration gewünscht?",
            type: "text",
            placeholder: "ja / nein",
            optional: true,
          },
        ],
      },
      {
        id: "C4",
        title: "CRM / Anfragen-Verwaltung",
        deliveryType: "angabe",
        required: false,
        blocker: false,
        role: "team",
        anleitung:
          "Nur falls Ihre Praxis bereits ein System zur Verwaltung von Interessenten-Anfragen nutzt. Falls nicht: leer lassen, das EINS-Portal übernimmt das.",
        fields: [
          { key: "system", label: "System", type: "text", optional: true },
          { key: "kontakt", label: "Kontakt", type: "text", optional: true },
        ],
      },
      {
        id: "C5",
        title: "Praxisverwaltungssystem (PVS)",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Nur Name und Version eintragen, sonst nichts. Den Lesezugang richten wir je nach System gemeinsam mit Ihrem PVS-Support ein; EINS leitet das an und meldet sich dazu bei Ihnen.",
        warum:
          "So sehen Sie später im Portal, welcher Umsatz aus den Anfragen wirklich entstanden ist.",
        fields: [
          {
            key: "name",
            label: "Name",
            type: "text",
            placeholder: "z. B. medatixx, Tomedo, CGM, Dampsoft",
          },
          {
            key: "version",
            label: "Version",
            type: "text",
            optional: true,
          },
          {
            key: "itKontakt",
            label: "Ansprechperson für IT",
            type: "text",
            optional: true,
          },
        ],
      },
      {
        id: "C6",
        title: "Portal-Zugänge für Ihr Team",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Wer in Ihrer Praxis soll das EINS-Portal nutzen können (Anfragen sehen, Auswertungen lesen)? Sie können Ihr Team auch direkt unter Einstellungen → Team einladen; dann hier nur kurz vermerken und abhaken.",
        fields: [
          {
            key: "team",
            label: "Personen",
            type: "textarea",
            placeholder: "Pro Person: Name, E-Mail, Rolle (Rezeption / Marketing / Ärztin/Arzt)",
          },
        ],
      },
    ],
  },
  {
    key: "D",
    title: "Marke und Bildmaterial",
    intro:
      "Vorher-Nachher-Bilder laden Sie bitte nicht hoch: Wir zeigen keine Vorher-Nachher-Darstellungen, weder in Beiträgen noch in Anzeigen (§ 3 und § 11 HWG).",
    items: [
      {
        id: "D1",
        title: "Logo als Vektordatei",
        deliveryType: "upload",
        uploadProfile: "logo",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Laden Sie Ihr Logo als SVG-, EPS- oder AI-Datei hoch. Falls Sie nur ein PNG haben: bitte in der höchsten verfügbaren Auflösung. Tipp: Die Vektordatei hat meist die Agentur, die Ihr Logo gestaltet hat; eine kurze E-Mail dorthin genügt in der Regel.",
        warum:
          "Aus dem Logo bauen wir Beiträge, Zielseiten und Anzeigen; eine Vektordatei bleibt in jeder Größe scharf.",
      },
      {
        id: "D2",
        title: "Farbwerte und Schriften (CI-Dokument)",
        deliveryType: "upload",
        uploadProfile: "dokument",
        required: false,
        blocker: false,
        role: "team",
        anleitung:
          "Falls es ein Dokument mit Ihren Praxis-Farben und Schriften gibt (Styleguide, CI-Mappe), laden Sie es hoch. Falls nicht: leer lassen, wir leiten die Werte aus Logo und Website ab.",
      },
      {
        id: "D3",
        title: "Vorhandene Fotos",
        deliveryType: "upload_oder_link",
        uploadProfile: "bild",
        required: false,
        blocker: false,
        role: "team",
        recommended: true,
        anleitung:
          "Praxis-Räume, Team, Ärztin/Arzt: auch ältere Aufnahmen helfen, wir entscheiden, was nutzbar ist. Einzelne Dateien können Sie direkt hochladen; bei größeren Sammlungen tragen Sie einfach einen Freigabe-Link ein (Google Drive, Dropbox oder WeTransfer: Dateien dort hochladen, Link mit Leserechten erstellen, hier einfügen).",
      },
      {
        id: "D4",
        title: "Vorhandene Videos",
        deliveryType: "link",
        required: false,
        blocker: false,
        role: "team",
        anleitung:
          "Videodateien sind zum direkten Hochladen meist zu groß. Laden Sie sie bei Google Drive, Dropbox oder WeTransfer hoch und tragen Sie hier den Freigabe-Link ein.",
      },
      {
        id: "D6",
        title: "Zertifikate, Facharzt-Urkunden, Mitgliedschaften",
        deliveryType: "upload",
        uploadProfile: "bild",
        required: false,
        blocker: false,
        role: "team",
        recommended: true,
        anleitung:
          "Facharzt-Urkunden, Zertifikate, Mitgliedschaften (z. B. DGÄPC, DGBT) als Scan oder Foto hochladen.",
        warum:
          "Solche Nachweise machen Ihre Zielseiten glaubwürdig und heben Sie von Anbietern ohne Qualifikation ab.",
      },
    ],
  },
  {
    key: "E",
    title: "Praxis-Informationen",
    items: [
      {
        id: "E1",
        title: "Behandlungsliste mit Preisspannen",
        deliveryType: "upload_oder_link",
        uploadProfile: "dokument",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          'Mindestens für die 1 bis 2 Fokus-Behandlungen: Behandlung und Preisspanne (z. B. "Faltenunterspritzung 250 bis 450 €"). Eine bestehende Preisliste können Sie als PDF hochladen; alternativ tragen Sie die Spannen direkt ein.',
        warum:
          "Ohne Preisspannen können wir Anfragen nicht nach Wert vorsortieren.",
        fields: [
          {
            key: "behandlungen",
            label: "Behandlungen mit Preisspannen",
            type: "textarea",
            placeholder: "z. B. Faltenunterspritzung 250 bis 450 €",
            optional: true,
          },
        ],
      },
      {
        id: "E2",
        title: "Standorte",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Tragen Sie alle Standorte ein, an denen behandelt wird. Das Einzugsgebiet bestimmt, für welche Region wir Beiträge und Anzeigen ausrichten.",
        fields: [
          {
            key: "standorte",
            label: "Standorte",
            type: "textarea",
            placeholder:
              "Pro Standort: Adresse, Öffnungszeiten, Telefonnummer",
          },
          {
            key: "einzugsgebiet",
            label: "Einzugsgebiet",
            type: "text",
            placeholder: "Städte / Umkreis",
          },
        ],
      },
      {
        id: "E3",
        title: "Team-Übersicht",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Eine kurze Liste reicht. Wichtig ist vor allem: Wer ruft neue Interessenten zurück?",
        fields: [
          {
            key: "team",
            label: "Wer behandelt was, wer nimmt Anfragen entgegen",
            type: "textarea",
            placeholder: "Name + Funktion",
          },
        ],
      },
      {
        id: "E4",
        title: "Impressums- und Rechnungsdaten",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Diese Angaben brauchen wir für das Impressum Ihrer Zielseiten und für die Abrechnung; bitte exakt wie im bestehenden Impressum Ihrer Website.",
        fields: [
          { key: "praxisname", label: "Vollständiger Praxisname", type: "text" },
          { key: "rechtsform", label: "Rechtsform", type: "text" },
          {
            key: "berufsbezeichnung",
            label: "Berufsbezeichnung",
            type: "text",
          },
          {
            key: "aerztekammer",
            label: "Zuständige Ärztekammer",
            type: "text",
          },
          {
            key: "rechnungsanschrift",
            label: "Rechnungsanschrift",
            type: "textarea",
          },
        ],
      },
      {
        id: "E5",
        title: "Freie Beratungskapazität",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Wie viele Erstberatungen pro Woche sind realistisch frei? Ehrliche Schätzung genügt; danach richten wir aus, wie viele Anfragen wir zu Ihnen leiten, damit keine Anfragen liegen bleiben.",
        fields: [
          {
            key: "kapazitaet",
            label: "Beratungstermine pro Woche für neue Patienten",
            type: "text",
            placeholder: "Zahl oder Spanne",
          },
        ],
      },
      {
        id: "E6",
        title: "Nummer für die Anfragen-Übergabe",
        deliveryType: "angabe",
        required: true,
        blocker: false,
        role: "team",
        anleitung:
          "Wohin sollen wir hochpreisige Anfragen durchstellen? Diese Nummer sollte werktags verlässlich besetzt sein.",
        fields: [
          {
            key: "nummer",
            label: "Telefon- und/oder WhatsApp-Nummer",
            type: "text",
            format: "tel",
          },
          {
            key: "zeiten",
            label: "Erreichbare Zeiten",
            type: "text",
          },
        ],
      },
    ],
  },
  {
    key: "F",
    title: "Rechtliches und Compliance",
    items: [
      {
        id: "F2",
        title: "Frühere HWG-Prüfungen oder Abmahnungen",
        deliveryType: "upload_oder_link",
        uploadProfile: "dokument",
        required: true,
        blocker: false,
        role: "team",
        allowKeineVorhanden: true,
        anleitung:
          'Gab es früher werberechtliche Prüfungen oder Abmahnungen (z. B. durch Kammer oder Wettbewerbszentrale)? Falls ja: kurze Info eintragen und, falls vorhanden, die Unterlagen hochladen. Falls nein: "Keine vorhanden" wählen. Beides ist für uns in Ordnung, wir müssen es nur wissen, bevor wir Beiträge veröffentlichen oder werben (Hauptvertrag § 5 Abs. 2 lit. e).',
        fields: [
          {
            key: "beschreibung",
            label: "Kurze Beschreibung",
            type: "textarea",
            optional: true,
          },
        ],
      },
      {
        id: "F3",
        title: "Datenschutz-Kontakt der Praxis",
        deliveryType: "angabe",
        required: false,
        blocker: false,
        role: "team",
        anleitung:
          "Nur ausfüllen, falls Ihre Praxis einen Datenschutzbeauftragten hat (Pflicht erst ab einer bestimmten Praxisgröße).",
        fields: [
          {
            key: "name",
            label: "Name des Datenschutzbeauftragten",
            type: "text",
            optional: true,
          },
          {
            key: "email",
            label: "E-Mail",
            type: "text",
            optional: true,
            format: "email",
          },
        ],
      },
      {
        id: "F4",
        title: "Datenschutz-Texte für das Anfrageformular",
        deliveryType: "status",
        required: true,
        blocker: false,
        role: "inhaber",
        anleitung:
          "EINS stellt geprüfte Datenschutz-Texte für das Anfrageformular Ihrer Zielseiten. Mit diesem Haken bestätigen Sie, dass diese Texte ungekürzt übernommen werden (Hauptvertrag § 5 Abs. 2 lit. h).",
      },
      {
        // Successor of the retired F1 (Patienten-Einwilligungen fuer den
        // Produktionstag). New id on purpose: F1 rows/files keep their old
        // meaning and are never reinterpreted.
        id: "F5",
        title: "Einwilligung KI-Abbild und Stimme",
        deliveryType: "upload",
        uploadProfile: "dokument",
        required: true,
        blocker: false,
        role: "inhaber",
        anleitung:
          "Für Ihren KI-Klon nutzen wir Ihr Gesicht und Ihre Stimme. Dafür brauchen wir Ihre unterschriebene Einwilligung für KI-Abbild und Stimme. Die Vorlage stellt EINS bereit. Bitte unterschreiben Sie sie und laden Sie die unterschriebene Fassung hier als PDF oder Foto hoch. Vor Ihrer unterschriebenen Einwilligung bauen wir weder Ihr Gesicht noch Ihre Stimme nach. Widerrufen Sie die Einwilligung, stoppen wir sofort alle Beiträge mit Ihrem Klon und löschen das Klon-Modell (Hauptvertrag § 5 Abs. 2 lit. g).",
        warum:
          "Ihr KI-Klon gehört Ihnen. Wir nutzen Ihr Gesicht und Ihre Stimme nur für Ihre Praxis, nie für eigene Werbung ohne Ihre gesonderte schriftliche Einwilligung, und löschen das Klon-Modell spätestens 30 Tage nach Vertragsende.",
      },
      {
        // Added 2026-09-30: consent of the persons visible or audible in the
        // practice's existing material (D3/D4), before EINS uses it. Not a
        // blocker, not required (the practice may hand over no material).
        // TODO(karam): EINS template for these consents does not exist yet;
        // the Anleitung deliberately does not promise one.
        id: "F6",
        title: "Einwilligungen für vorhandenes Material",
        deliveryType: "upload_oder_link",
        uploadProfile: "dokument",
        required: false,
        blocker: false,
        role: "team",
        recommended: true,
        allowKeineVorhanden: true,
        anleitung:
          "Laden Sie hier die schriftlichen Einwilligungen aller Personen hoch, die in Ihrem vorhandenen Material (Punkt D3 und D4) zu sehen oder zu hören sind: Ihr Team sowie Patientinnen und Patienten, zum Beispiel in Patientenstimmen. Ohne Einwilligung nutzen wir kein Material, auf dem eine Person erkennbar ist. Mehrere Einwilligungen können Sie als ein PDF oder als Freigabe-Link liefern (Google Drive, Dropbox oder WeTransfer: Dateien dort hochladen, Link mit Leserechten erstellen, hier einfügen). Haben Sie kein solches Material oder geben uns keins, wählen Sie \"Keine vorhanden\".",
        warum:
          "Wer in Ihrem Material zu sehen oder zu hören ist, muss der Nutzung zugestimmt haben, bevor wir es verwenden. Das schützt die Personen und Ihre Praxis.",
      },
    ],
  },
];

// ---------------------------------------------------------------
// Static closing note (Block G - laufende Mitwirkung). Information only,
// nothing to check off.
// ---------------------------------------------------------------

export const ABSCHLUSS_HINWEIS = {
  title: "Was danach zählt",
  intro:
    "Diese Punkte sind keine Lieferung, sondern Ihre laufende Mitwirkung während der Zusammenarbeit:",
  points: [
    "Beiträge freigeben oder konkret ändern: innerhalb von 2 Werktagen. Wir schicken Ihnen die Beiträge einmal pro Woche gesammelt. Das ist in wenigen Minuten erledigt: ansehen, ja oder nein. Es gibt keine automatische Freigabe, denn kein Beitrag geht ohne Ihre Freigabe raus.",
    "Den Profil-Link zur Zielseite und die Tracking-Nummer nicht entfernen. Darüber messen wir, welche Anfragen über EINS kommen.",
    "Antwortzeit: Bitte versuchen Sie, jede Anfrage innerhalb von 48 Werkstunden zu kontaktieren. Das ist keine Bedingung der Garantie. Schaffen Sie es nicht, hat das drei Folgen: Sie können bei dieser Anfrage nicht mehr einwenden, die Person sei nicht echt oder nicht erreichbar gewesen. Die Anfrage steht in Ihrer Auswertung als \"von der Praxis nicht beantwortet\". Und liegen drei oder mehr solcher Anfragen offen, dürfen wir nach einer Warnung die bezahlten Anzeigen pausieren, bis Sie die Anfragen kontaktiert haben.",
    "Empfehlung, keine Bedingung: ein benanntes Mitglied Ihres Praxisteams an der Schulung teilnehmen lassen.",
    "Jeder Tag, an dem Sie mit einer Mitwirkung in Verzug sind (Lieferung aus dieser Checkliste, Freigabe von Beiträgen), verlängert die 90 Tage um einen Tag. Die Garantie: Sie zahlen nichts, bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt.",
  ],
} as const;

/** Block G, live part: the Praxis's own EINS tracking numbers and booking links. */
export const MESSWEGE_HINWEIS = {
  title: "Ihre Tracking-Nummer und Ihr Buchungslink",
  intro:
    "Über diese Nummern und Links messen wir, welche Anrufe und Buchungen über EINS kommen. Bitte entfernen Sie sie nicht.",
  numbersLabel: "Tracking-Nummern",
  linksLabel: "Buchungslinks",
  empty:
    "Ihre Tracking-Nummer und Ihr Buchungslink erscheinen hier, sobald EINS sie eingerichtet hat.",
} as const;

export const CHECKLISTE_INTRO =
  "Damit wir Ihren KI-Klon, Ihre Beiträge und Ihre Zielseiten aufsetzen können, brauchen wir einmalig ein paar Zugänge, Dateien und Angaben. Alles läuft über dieses Portal, kein Versand per E-Mail nötig. Sie sehen jederzeit, was schon geliefert und was von uns geprüft ist.";

// ---------------------------------------------------------------
// Derived lookups + helpers
// ---------------------------------------------------------------

export const ALL_CHECKLIST_ITEMS: ChecklistItem[] = CHECKLIST_BLOCKS.flatMap(
  (b) => b.items
);

export const CHECKLIST_ITEMS_BY_ID = new Map<string, ChecklistItem>(
  ALL_CHECKLIST_ITEMS.map((i) => [i.id, i])
);

export const REQUIRED_CHECKLIST_IDS: string[] = ALL_CHECKLIST_ITEMS.filter(
  (i) => i.required
).map((i) => i.id);

export const BLOCKER_CHECKLIST_IDS: string[] = ALL_CHECKLIST_ITEMS.filter(
  (i) => i.blocker
).map((i) => i.id);

/** Answer map stored in checklist_items.answer. */
export type ChecklistAnswer = Record<string, string | boolean>;

export interface ChecklistFileMeta {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  contentType: string | null;
  uploadedAt: Date;
}

// ---------------------------------------------------------------
// Contact-field validation (email / phone). Shared by the client (inline
// errors, save-blocking) and the server action (source of truth). QA was able
// to save "keine-email-adresse" and "null einssss" as delivered contact data;
// these guards stop garbage that EINS later tries to actually reach out to.
// ---------------------------------------------------------------

/** Deliberately loose but robust: one @, a dot in the domain, no whitespace. */
export const CHECKLIST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidChecklistEmail(value: string): boolean {
  return CHECKLIST_EMAIL_RE.test(value.trim());
}

/** Digits, spaces, +, /, -, parentheses; must contain at least 6 digits. */
export function isValidChecklistPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[\d\s+/()-]+$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 6;
}

export const CHECKLIST_FIELD_ERROR: Record<
  NonNullable<AngabeField["format"]>,
  string
> = {
  email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  tel: "Bitte geben Sie eine gültige Telefonnummer ein.",
};

export const CHECKLIST_LINK_ERROR =
  "Bitte fügen Sie den vollständigen Freigabe-Link ein, zum Beispiel https://drive.google.com/…";

/**
 * Normalise a pasted share link. People paste "drive.google.com/..." without a
 * scheme: prefix https:// so the admin view gets an absolute link instead of a
 * relative one. Only http(s) with a dotted host is accepted; null otherwise
 * (javascript:, data:, file:, plain words).
 */
export function normalizeChecklistLink(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  let withScheme: string;
  if (/^https?:\/\//i.test(v)) withScheme = v;
  else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v) && !/^[^:/]*\.[^:/]*:\d/.test(v)) {
    // Another scheme (javascript:, data:, file:, mailto:, ...).
    return null;
  } else withScheme = `https://${v.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * Validate every formatted contact field that carries a value. Empty fields
 * pass here (Pflicht-completeness is handled separately); only malformed input
 * is rejected. Returns a per-field-key map of German error messages.
 */
export function validateChecklistFields(
  item: ChecklistItem,
  answer: ChecklistAnswer
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of item.fields ?? []) {
    if (!field.format) continue;
    const value = answer[field.key];
    if (typeof value !== "string" || value.trim() === "") continue;
    if (field.format === "email" && !isValidChecklistEmail(value)) {
      errors[field.key] = CHECKLIST_FIELD_ERROR.email;
    } else if (field.format === "tel" && !isValidChecklistPhone(value)) {
      errors[field.key] = CHECKLIST_FIELD_ERROR.tel;
    }
  }
  const link = answer.link;
  if (
    itemAcceptsLink(item.deliveryType) &&
    typeof link === "string" &&
    link.trim() !== "" &&
    normalizeChecklistLink(link) === null
  ) {
    errors.link = CHECKLIST_LINK_ERROR;
  }
  return errors;
}

export function itemAcceptsUpload(type: DeliveryType): boolean {
  return type === "upload" || type === "upload_oder_link";
}

export function itemAcceptsLink(type: DeliveryType): boolean {
  return type === "link" || type === "upload_oder_link";
}

/** True once the clinic has done its part (counts toward onboarding progress). */
export function isDelivered(status: ChecklistStatus | undefined): boolean {
  return (
    status === "geliefert" || status === "geprueft" || status === "entfaellt"
  );
}

/** True only once EINS has confirmed (or the item was marked nicht vorhanden). */
export function isClosed(status: ChecklistStatus | undefined): boolean {
  return status === "geprueft" || status === "entfaellt";
}
