/**
 * Domain constants — referenced by UI, APIs, and worker jobs.
 * Shared so we don't drift.
 */

export const REQUEST_STATUSES = [
  "neu",
  "kontaktiert",
  "nicht_erreicht",
  "termin_vereinbart",
  "beratung_erschienen",
  "gewonnen",
  "verloren",
  "spam",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  neu: "Neu",
  kontaktiert: "Kontaktiert",
  nicht_erreicht: "Nicht erreicht",
  termin_vereinbart: "Termin vereinbart",
  beratung_erschienen: "Beratung erschienen",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
  spam: "Spam",
};

/**
 * Allowed forward/backward status transitions in the pre-booking working
 * phase (Portal-native). `kontaktiert` (erreicht, dran) und `nicht_erreicht`
 * (versucht, niemand erreicht) sitzen zwischen `neu` und `termin_vereinbart`,
 * damit das Frontdesk den Telefonstand abbilden kann.
 *
 * Backwards entries (z. B. `termin_vereinbart → kontaktiert`, `verloren → neu`)
 * sind für Daten-Korrekturen gedacht — das Standardflow ist vorwärts. `no_show`
 * und `behandelt` sind reine PVS-derived Status: sie kommen aus der Bridge und
 * tauchen hier bewusst nicht als manuell wählbare Ziele auf.
 */
export const STATUS_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  neu: ["kontaktiert", "nicht_erreicht", "termin_vereinbart", "spam", "verloren"],
  kontaktiert: ["termin_vereinbart", "nicht_erreicht", "verloren", "neu"],
  nicht_erreicht: ["kontaktiert", "termin_vereinbart", "verloren", "neu"],
  termin_vereinbart: ["beratung_erschienen", "verloren", "kontaktiert"],
  beratung_erschienen: ["gewonnen", "verloren", "termin_vereinbart"],
  gewonnen: ["verloren"],
  verloren: ["neu"],
  spam: ["neu"],
};

/**
 * Per-call outcome captured on the call-log activity. Distinct from the
 * lead's overall status: a single "nicht erreicht" call attempt can flip the
 * lead status to `nicht_erreicht`, but the outcome lives on the activity so
 * the Verlauf shows what actually happened on each call.
 */
export const CALL_OUTCOMES = [
  "erreicht",
  "nicht_erreicht",
  "mailbox",
  "falsche_nummer",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  erreicht: "Erreicht",
  nicht_erreicht: "Nicht erreicht",
  mailbox: "Mailbox",
  falsche_nummer: "Falsche Nummer",
};

/** Wiedervorlage lifecycle (request_followups.status). */
export const FOLLOWUP_STATUSES = ["pending", "done", "cancelled"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const ROLES = ["inhaber", "marketing", "frontdesk"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  inhaber: "Inhaber",
  marketing: "Marketing-Verantwortlicher",
  frontdesk: "Frontdesk",
};

export const REQUEST_SOURCES = [
  "meta",
  "google",
  "formular",
  "manuell",
  "whatsapp",
] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const SOURCE_LABELS: Record<RequestSource, string> = {
  meta: "Meta / Instagram",
  google: "Google Ads",
  formular: "Zielseiten-Formular",
  manuell: "Manueller Eintrag",
  whatsapp: "WhatsApp",
};

export const AI_CATEGORIES = ["hot", "warm", "cold"] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

export const AI_CATEGORY_LABELS: Record<AiCategory, string> = {
  hot: "Sehr heiß",
  warm: "Warm",
  cold: "Kalt",
};

/**
 * Sort orders for the Anfragen inbox list. `neueste` is the default (newest
 * first) and is represented by the absence of the `sort` URL param, so the
 * canonical /anfragen URL stays clean.
 */
export const REQUEST_SORTS = [
  "neueste",
  "aelteste",
  "ki",
  "ltv",
  "dringlichkeit",
] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];

export const REQUEST_SORT_LABELS: Record<RequestSort, string> = {
  neueste: "Neueste zuerst",
  aelteste: "Älteste zuerst",
  ki: "Höchste KI-Bewertung",
  ltv: "Höchster Lifetime-Wert",
  dringlichkeit: "Dringlichkeit",
};

/** SLA respond-by-time in hours for new leads. */
export const SLA_HOURS = 3;

export const ACTIVITY_KINDS = [
  "note",
  "call",
  "email",
  "whatsapp",
  "status_change",
  "ai_rescore",
  "assignment",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  note: "Notiz",
  call: "Anruf",
  email: "E-Mail",
  whatsapp: "WhatsApp",
  status_change: "Status-Änderung",
  ai_rescore: "KI-Bewertung aktualisiert",
  assignment: "Zuweisung",
};

export const ASSET_KINDS = ["video", "foto", "rohmaterial", "behind_scenes"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const DOCUMENT_KINDS = [
  "vertrag",
  "avv",
  "auswertung_monatlich",
  "vertriebsleitfaden",
  "hwg_pruefung",
  "sonstiges",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  vertrag: "Vertrag",
  avv: "Auftragsverarbeitungsvertrag",
  auswertung_monatlich: "Monats-Auswertung",
  vertriebsleitfaden: "Leitfaden",
  hwg_pruefung: "HWG-Prüfung",
  sonstiges: "Sonstiges",
};

/** Animation customization lifecycle. */
export const ANIMATION_STATES = [
  "standard",
  "requested",
  "in_production",
  "ready",
] as const;
export type AnimationState = (typeof ANIMATION_STATES)[number];

export const ANIMATION_STATE_LABELS: Record<AnimationState, string> = {
  standard: "Standard",
  requested: "Angefordert",
  in_production: "In Produktion",
  ready: "Bereit",
};

export const FEEDBACK_CATEGORIES = [
  "verbesserung",
  "fehler",
  "lob",
  "frage",
  "sonstiges",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  verbesserung: "Verbesserungsvorschlag",
  fehler: "Fehler / Bug",
  lob: "Lob",
  frage: "Frage",
  sonstiges: "Sonstiges",
};

export const FEEDBACK_STATUSES = [
  "offen",
  "gesehen",
  "bearbeitet",
  "verworfen",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  offen: "Offen",
  gesehen: "Gesehen",
  bearbeitet: "Bearbeitet",
  verworfen: "Verworfen",
};

/** Clinic-facing "Fortschritt" timeline entries — admin-authored milestones. */
export const TIMELINE_STATUSES = [
  "geplant",
  "laeuft",
  "abgeschlossen",
] as const;
export type TimelineStatus = (typeof TIMELINE_STATUSES)[number];

export const TIMELINE_STATUS_LABELS: Record<TimelineStatus, string> = {
  geplant: "Geplant",
  laeuft: "Läuft",
  abgeschlossen: "Abgeschlossen",
};

/** EINS Bewertungen — private patient_feedback triage states. */
export const PATIENT_FEEDBACK_STATUSES = [
  "neu",
  "gesehen",
  "beantwortet",
  "geschlossen",
] as const;
export type PatientFeedbackStatus = (typeof PATIENT_FEEDBACK_STATUSES)[number];

export const PATIENT_FEEDBACK_STATUS_LABELS: Record<
  PatientFeedbackStatus,
  string
> = {
  neu: "Neu",
  gesehen: "Gesehen",
  beantwortet: "Beantwortet",
  geschlossen: "Geschlossen",
};

/**
 * Apply the `__Host-` cookie-name prefix in production. The prefix is a
 * browser-enforced lock: the cookie MUST be Secure, Path=/ and carry no
 * Domain attribute, which stops a sibling subdomain (or a network attacker
 * on a cleartext sibling) from clobbering it (pentest authn-08). It cannot
 * be used over plain-http localhost (Secure is unsettable there), so dev
 * keeps the bare name. Set + read + delete all go through this helper, so
 * the name stays consistent within an environment.
 */
export function hostCookieName(base: string): string {
  return process.env.NODE_ENV === "production" ? `__Host-${base}` : base;
}

/** Session cookie */
export const SESSION_COOKIE = hostCookieName("eins_session");
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h idle timeout
/**
 * "Angemeldet bleiben": Häkchen beim Login verlängert die Session von 8 Stunden
 * auf 30 Tage. Der Wert steuert ALLE drei Lebenszeiten gleichzeitig (JWT-Exp,
 * Cookie-maxAge und sessions.expires_at); driften sie auseinander, stirbt die
 * Session am kürzesten der drei Werte.
 */
export const SESSION_REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 Tage

/** Magic-link TTL */
export const MAGIC_LINK_TTL_SECONDS = 60 * 15; // 15 minutes

/** Audit log retention in months (plan §11) */
export const AUDIT_RETENTION_MONTHS = 24;

/** Dashboard cache TTL for live advertising data. */
export const CAMPAIGN_LIVE_CACHE_SECONDS = 15 * 60;

/**
 * Ansprechpartner surfaced in the sidebar contact card (SidebarContactCard).
 *
 * There is no per-clinic account-manager field in the data model yet, so this
 * is a single shared EINS-Team identity. When clinics get a named
 * Ansprechpartner, pass an override into `PortalShell` instead of relying on
 * this default — the card already accepts a `contact` prop.
 *
 * `bookingUrl` is the same Calendly link the marketing site uses.
 */
export const EINS_CONTACT = {
  name: "Ihr EINS-Team",
  bookingUrl: "https://calendly.com/karam8issa/30min",
  email: "team@eins.ag",
} as const;

/**
 * Cookie persisting whether the sidebar contact card (SidebarContactCard) is
 * minimized. Read server-side in the (portal) layout so the first paint
 * matches the user's last choice (no expand→collapse flash), written
 * client-side on toggle. Value: "1" = minimized, anything else = expanded.
 */
export const CONTACT_CARD_COOKIE = "eins_contact_card_collapsed";
