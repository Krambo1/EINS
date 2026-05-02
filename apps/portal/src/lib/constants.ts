/**
 * Domain constants — referenced by UI, APIs, and worker jobs.
 * Shared so we don't drift.
 */

export const REQUEST_STATUSES = [
  "neu",
  "qualifiziert",
  "termin_vereinbart",
  "beratung_erschienen",
  "gewonnen",
  "verloren",
  "spam",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  neu: "Neu",
  qualifiziert: "Qualifiziert",
  termin_vereinbart: "Termin vereinbart",
  beratung_erschienen: "Beratung erschienen",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
  spam: "Spam",
};

/**
 * Allowed forward/backward status transitions.
 * Backwards only "termin_vereinbart → qualifiziert" etc. for data correction.
 */
export const STATUS_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  neu: ["qualifiziert", "spam", "verloren"],
  qualifiziert: ["termin_vereinbart", "verloren", "spam"],
  termin_vereinbart: ["beratung_erschienen", "verloren", "qualifiziert"],
  beratung_erschienen: ["gewonnen", "verloren", "termin_vereinbart"],
  gewonnen: ["verloren"],
  verloren: ["qualifiziert"],
  spam: ["neu"],
};

export const ROLES = ["inhaber", "marketing", "frontdesk"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  inhaber: "Inhaber",
  marketing: "Marketing-Verantwortlicher",
  frontdesk: "Frontdesk",
};

export const PLAN_TIERS = ["standard", "erweitert"] as const;
export type Plan = (typeof PLAN_TIERS)[number];

export const PLAN_LABELS: Record<Plan, string> = {
  standard: "Standard",
  erweitert: "Erweitert",
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

/** SLA respond-by-time in hours, per plan. */
export const SLA_HOURS: Record<Plan, number> = {
  standard: 24,
  erweitert: 3,
};

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
  ai_rescore: "KI-Score aktualisiert",
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
  vertriebsleitfaden: "Vertriebsleitfaden",
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

/** Session cookie */
export const SESSION_COOKIE = "eins_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h idle timeout

/** Magic-link TTL */
export const MAGIC_LINK_TTL_SECONDS = 60 * 15; // 15 minutes

/** Audit log retention in months (plan §11) */
export const AUDIT_RETENTION_MONTHS = 24;

/** Dashboard cache TTL for live advertising data. */
export const CAMPAIGN_LIVE_CACHE_SECONDS = 15 * 60;
