/**
 * Audit-Log on /einstellungen (VD3): the Praxis sees a German sentence, never
 * the raw `action` / `entity_kind` identifiers. Whole phrases for the actions
 * that read oddly as "<Ding> <Verb>", otherwise noun + verb, otherwise a
 * neutral fallback.
 */

const PHRASES: Record<string, string> = {
  login: "Anmeldung",
  logout: "Abmeldung",
  magic_link_request: "Anmeldelink angefordert",
  magic_link_consume: "Mit Anmeldelink angemeldet",
  impersonate_start: "EINS hat Ihre Ansicht geöffnet",
  impersonate_end: "EINS hat Ihre Ansicht geschlossen",
  oauth_start: "Verbindung zu einem Werbekonto gestartet",
  oauth_connect: "Werbekonto verbunden",
  disconnect: "Werbekonto getrennt",
  meta_page_select: "Facebook-Seite gewählt",
  meta_page_select_refused: "Facebook-Seite abgelehnt (gehört zu einer anderen Praxis)",
  reopen_discovery_fragebogen: "Fragebogen wieder geöffnet",
  submit_leitfaden_quiz: "Leitfaden-Prüfung abgeschickt",
  submit_feedback: "Rückmeldung an EINS gesendet",
  save_checklist_item: "Checkliste bearbeitet",
  request_animation: "Animation angefordert",
  hwg_check: "HWG-Prüfung genutzt",
  dismiss_nav_card: "Hinweis ausgeblendet",
  ads_consent_revoke: "Einwilligung für Werbe-Meldungen widerrufen",
  pvs_csv_upload: "Datei aus der Praxissoftware hochgeladen",
  pvs_csv_mapping_confirmed: "Spalten der Praxissoftware-Datei bestätigt",
  pvs_treatment_mapped: "Behandlung der Praxissoftware zugeordnet",
  pvs_location_mapped: "Standort der Praxissoftware zugeordnet",
  pvs_secret_rotated: "Schlüssel der Praxissoftware erneuert",
  rotate: "Schlüssel erneuert",
  export: "Daten exportiert",
  download: "Datei heruntergeladen",
  upload: "Datei hochgeladen",
};

const NOUNS: Record<string, string> = {
  request: "Anfrage",
  request_followup: "Wiedervorlage",
  request_activity: "Anfrage-Verlauf",
  patient: "Patientendaten",
  patient_feedback: "Patienten-Rückmeldung",
  treatment: "Behandlung",
  location: "Standort",
  clinic: "Praxisdaten",
  clinic_user: "Teammitglied",
  platform_credential: "Werbekonto",
  platform_credentials: "Werbekonto",
  intake_secret: "Zielseiten-Schlüssel",
  client_upload: "Datei",
  checklist_item: "Checkliste",
  checklist_file: "Checklisten-Datei",
  discovery_fragebogen: "Fragebogen",
  clinic_review_settings: "Bewertungs-Einstellungen",
  clinic_retreatment_settings: "Wiederbehandlungs-Einstellungen",
  treatment_retreatment_intervals: "Wiederbehandlungs-Abstände",
  clinic_ads_conversion_config: "Abschluss-Meldungen",
  review_request: "Bewertungsanfrage",
  reviews: "Bewertungen",
  onboarding_tour: "Rundgang",
  dsgvo_export: "Datenauskunft",
  dsgvo_erasure: "Datenlöschung",
  feedback: "Rückmeldung",
};

const VERBS: Record<string, string> = {
  create: "angelegt",
  update: "geändert",
  delete: "gelöscht",
  archive: "archiviert",
  view: "angesehen",
  invite: "eingeladen",
  send: "gesendet",
  approve: "freigegeben",
  complete: "abgeschlossen",
  transition: "Status geändert",
  skip: "übersprungen",
  sync: "abgeglichen",
};

export function auditLabel(action: string, entityKind: string | null): string {
  const phrase = PHRASES[action];
  if (phrase) return phrase;
  const noun = entityKind ? NOUNS[entityKind] : undefined;
  const verb = VERBS[action];
  if (noun && verb) return `${noun} ${verb}`;
  if (noun) return `${noun} bearbeitet`;
  if (verb) return `Eintrag ${verb}`;
  return "Sonstige Aktion";
}
