/**
 * Stable source taxonomy. The raw `requests.source` column is free text
 * (Meta webhook writes "meta", intake API writes "formular", PVS CSV writes
 * "csv", manual entries write "manuell", etc.). Forecast + reporting queries
 * need a constrained set of buckets that survives free-text drift.
 *
 * This module is the ONE source contract: ENTRY_SOURCES (what a producer may
 * write), their labels and aliases, the Messweg classification and the
 * attribution confidence. `constants.ts` only re-exports from here.
 * attribution.ts and forecast.ts go through `canonicalSource()` so an old or
 * misspelled stored value collapses to "unbekannt" instead of fragmenting a
 * per-source rate into a one-row sample.
 */

// ---------------------------------------------------------------------------
// Entry sources: the closed set a producer may write into requests.source
// ---------------------------------------------------------------------------

/**
 * Every value a producer (intake route, Meta webhook, Messweg webhooks, the
 * front-desk entry, the PVS import) may write into `requests.source` today.
 * Older stored values (e.g. "csv", "intake") stay valid in the DB: the
 * classifier below knows them, nothing is renamed.
 */
export const ENTRY_SOURCES = [
  "formular",
  "anruf",
  "buchung",
  "meta",
  "google",
  "manuell",
  "whatsapp",
  "pvs_import",
] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/**
 * Written only by the Messweg webhooks (provider-authenticated, tied to an
 * EINS number or link). The intake route rejects them, so no signed form
 * post can claim a call or booking.
 */
export const WEBHOOK_ONLY_SOURCES = ["anruf", "buchung"] as const satisfies readonly EntrySource[];

/**
 * Entered by the Praxis itself ("Anfrage anlegen" at the front desk; "manual"
 * is an older stored spelling). Never a Messweg; the entry is the contact
 * (server/queries/response-time.ts) and sends no "Neue Anfrage" mail.
 */
export const FRONT_DESK_SOURCES = ["manuell", "manual"] as const;

export function isFrontDeskSource(source: string | null | undefined): boolean {
  return !!source && (FRONT_DESK_SOURCES as readonly string[]).includes(source);
}

/** What the intake route accepts: every entry source except the webhook-only ones. */
export const INTAKE_SOURCES = ENTRY_SOURCES.filter(
  (s): s is Exclude<EntrySource, (typeof WEBHOOK_ONLY_SOURCES)[number]> =>
    !(WEBHOOK_ONLY_SOURCES as readonly string[]).includes(s)
) as [Exclude<EntrySource, (typeof WEBHOOK_ONLY_SOURCES)[number]>, ...Exclude<EntrySource, (typeof WEBHOOK_ONLY_SOURCES)[number]>[]];

export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  formular: "Zielseiten-Formular",
  anruf: "Anruf auf EINS-Tracking-Nummer",
  buchung: "Buchung über EINS-Buchungslink",
  meta: "Meta / Instagram",
  google: "Google Ads",
  manuell: "Manueller Eintrag",
  whatsapp: "WhatsApp",
  pvs_import: "PVS-Import",
};

/**
 * Names producers use for the same entry point (n8n recipes, partner
 * integrations, the verbose names in the docs). Translated before
 * validation, so naming drift never costs an inquiry.
 */
export const ENTRY_SOURCE_ALIASES: Readonly<Record<string, EntrySource>> = {
  landing_form: "formular",
  landingform: "formular",
  zielseite: "formular",
  tracking_anruf: "anruf",
  call_tracking: "anruf",
  tracking_call: "anruf",
  buchungslink: "buchung",
  booking: "buchung",
  booking_link: "buchung",
  meta_lead_ads: "meta",
  meta_lead_form: "meta",
  google_ads: "google",
  google_form: "google",
  manual: "manuell",
  wa: "whatsapp",
  pvs: "pvs_import",
};

/** Canonical entry source for a producer value, or null when unknown. */
export function parseEntrySource(raw: string | null | undefined): EntrySource | null {
  const s = raw?.trim().toLowerCase();
  if (!s) return null;
  if ((ENTRY_SOURCES as readonly string[]).includes(s)) return s as EntrySource;
  return ENTRY_SOURCE_ALIASES[s] ?? null;
}

/** Label for any stored source value; unknown values show as stored. */
export function entrySourceLabel(raw: string | null | undefined): string {
  const s = parseEntrySource(raw);
  return s ? ENTRY_SOURCE_LABELS[s] : raw ?? "";
}

// Reporting buckets (forecast, Auswertung) live at the end of this file:
// REPORTING_CHANNELS / reportingChannel(). They are derived from
// classifyAttribution(), so organic Instagram/Facebook/TikTok, profile-link
// and DM-link inquiries never collapse into the paid Meta bucket.

// ---------------------------------------------------------------------------
// Attribution: channel (where the person came from) and EINS-Messweg (how the
// inquiry technically reached EINS). Kanon section 5.
// ---------------------------------------------------------------------------

/**
 * Where an inquiry came from. Paid channels sit next to the organic ones
 * because EINS publishes organically first and puts ads behind the posts that
 * bring inquiries.
 */
export const ATTRIBUTION_CHANNELS = [
  "meta_anzeige",
  "google_anzeige",
  "instagram_organisch",
  "facebook_organisch",
  "tiktok_organisch",
  "profil_link",
  "dm_link",
  "direkt",
  "unbekannt",
] as const;

export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number];

export const ATTRIBUTION_CHANNEL_LABELS: Record<AttributionChannel, string> = {
  meta_anzeige: "Meta-Anzeige",
  google_anzeige: "Google-Anzeige",
  instagram_organisch: "Instagram-Beitrag",
  facebook_organisch: "Facebook-Beitrag",
  tiktok_organisch: "TikTok-Beitrag",
  profil_link: "Profil-Link",
  dm_link: "Link aus Direktnachricht",
  direkt: "Direkt (ohne Kennzeichnung)",
  unbekannt: "Unbekannt",
};

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "google"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * The only three ways an inquiry can trigger the first invoice
 * ("Keine Anfrage, keine Rechnung"):
 *   formular: form on an EINS Zielseite, also when the person arrived via the
 *             profile link or a link EINS sent in a direct message
 *   anruf:    call to an EINS tracking number
 *   buchung:  booking via the EINS booking link
 */
export const MESSWEGE = ["formular", "anruf", "buchung"] as const;
export type Messweg = (typeof MESSWEGE)[number];

export const MESSWEG_LABELS: Record<Messweg, string> = {
  formular: "Formular auf EINS-Zielseite",
  anruf: "Anruf auf EINS-Tracking-Nummer",
  buchung: "Buchung über EINS-Buchungslink",
};

/** Why an inquiry is not an EINS-Messweg. */
export const NOT_MESSWEG_REASONS = [
  "plattform_formular",
  "manueller_eintrag",
  "selbstauskunft",
  "import",
  "fremde_quelle",
  "unbekannte_quelle",
] as const;
export type NotMesswegReason = (typeof NOT_MESSWEG_REASONS)[number];

export const NOT_MESSWEG_REASON_LABELS: Record<NotMesswegReason, string> = {
  plattform_formular: "Formular direkt bei Meta oder Google, nicht auf einer EINS-Zielseite",
  manueller_eintrag: "Von Hand eingetragen",
  selbstauskunft: "Nur Selbstauskunft (Empfehlung, „aufmerksam geworden über“)",
  import: "Aus dem PVS importiert",
  fremde_quelle: "Kanal außerhalb von EINS (z. B. WhatsApp, Praxis-Website)",
  unbekannte_quelle: "Unbekannte Quelle",
};

export interface AttributionInput {
  /** `requests.source`, written by the system that received the inquiry. */
  source: string | null | undefined;
  /** `requests.utm` (jsonb). Anything that is not a string map is ignored. */
  utm?: unknown;
}

export interface Attribution {
  channel: AttributionChannel;
  platform: SocialPlatform | null;
  /** Null when the inquiry did not come in through an EINS-Messweg. */
  messweg: Messweg | null;
  /** Set exactly when `messweg` is null. */
  notMesswegReason: NotMesswegReason | null;
  /** utm_campaign, e.g. the treatment. */
  campaign: string | null;
  /** utm_content: the individual post or ad the person came from. */
  post: string | null;
}

// Raw `requests.source` values, grouped by the entry point that wrote them.
// "formular" is what clinic-landing (the EINS Zielseite) sends to
// /api/leads/intake. "website" is deliberately NOT a Messweg: a form on the
// Praxis's own website is not an EINS Zielseite. "anruf" and "buchung" are
// written by the Messweg webhooks (tracking number, EINS booking link).
const ENTRY_FORMULAR = new Set(["formular", "intake", "landing", "landing_form", "zielseite"]);
const ENTRY_ANRUF = new Set(["anruf", "tracking_anruf", "call_tracking", "tracking_call"]);
const ENTRY_BUCHUNG = new Set(["buchung", "buchungslink", "booking", "booking_link"]);
const ENTRY_META_FORM = new Set(["meta", "meta_lead_form"]);
// Written when someone reached the Praxis inside the app (e.g. a DM answered
// by hand) with no EINS link in between: organic channel, but not a Messweg.
const ENTRY_SOCIAL_DIRECT: Record<string, SocialPlatform> = {
  instagram: "instagram",
  ig: "instagram",
  facebook: "facebook",
  fb: "facebook",
  tiktok: "tiktok",
};
const SOCIAL_ORGANIC_CHANNEL: Record<Exclude<SocialPlatform, "google">, AttributionChannel> = {
  instagram: "instagram_organisch",
  facebook: "facebook_organisch",
  tiktok: "tiktok_organisch",
};
const ENTRY_GOOGLE_FORM = new Set(["google", "google_form", "google_ads"]);
const ENTRY_MANUELL = new Set(["manuell", "manual"]);
const ENTRY_SELBSTAUSKUNFT = new Set(["empfehlung", "referral", "word_of_mouth"]);
const ENTRY_IMPORT = new Set(["csv", "pvs", "pvs_import", "import"]);
const ENTRY_FREMD = new Set(["whatsapp", "wa", "website"]);

// UTM convention for EINS links (utm_medium). Aliases are accepted so a
// hand-built link still lands in the right bucket.
//   Profil-Link: ?utm_source=instagram&utm_medium=profil_link&utm_campaign=<behandlung>
//   DM-Link:     ?utm_source=instagram&utm_medium=dm&utm_campaign=<behandlung>&utm_content=<beitrag>
//   Beitrag:     ?utm_source=tiktok&utm_medium=organisch&utm_campaign=<behandlung>&utm_content=<beitrag>
//   Anzeige:     ?utm_source=facebook&utm_medium=anzeige&utm_campaign=<kampagne>&utm_content=<anzeige>
// The clinic-landing Zielseite strips utm_campaign/utm_term/utm_content from the visible address before any pixel loads, so these can stay readable; utm_source/utm_medium stay and must never name a treatment.
const MEDIUM_PROFIL = new Set([
  "profil_link", "profillink", "profil", "profile_link", "profile", "bio", "link_in_bio", "linkinbio",
]);
const MEDIUM_DM = new Set(["dm", "dm_link", "direktnachricht", "direct_message", "nachricht", "message"]);
const MEDIUM_PAID = new Set(["anzeige", "anzeigen", "cpc", "ppc", "paid", "paid_social", "paidsocial", "paid_search", "ads", "ad"]);
const MEDIUM_ORGANIC = new Set(["organisch", "organic", "social", "organic_social", "beitrag", "post", "reel", "story"]);

/** "Paid-Social" / "paid social" / "paid_social" all mean the same medium. */
export function normalizeMedium(v: string | null | undefined): string | null {
  const m = v?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return m ? m : null;
}

function platformOf(utmSource: string | null): SocialPlatform | "meta" | null {
  if (!utmSource) return null;
  if (utmSource === "instagram" || utmSource === "ig" || utmSource === "insta") return "instagram";
  if (utmSource === "facebook" || utmSource === "fb") return "facebook";
  if (utmSource === "tiktok" || utmSource === "tt") return "tiktok";
  if (utmSource === "google") return "google";
  if (utmSource === "meta") return "meta";
  return null;
}

/** Read the UTM bag defensively: jsonb comes back as `unknown`. */
export function readUtm(utm: unknown): Record<string, string> {
  if (!utm || typeof utm !== "object" || Array.isArray(utm)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(utm as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

function channelFromUtm(
  utm: Record<string, string>
): { channel: AttributionChannel; platform: SocialPlatform | null } {
  const medium = normalizeMedium(utm.utm_medium);
  const rawPlatform = platformOf(utm.utm_source?.toLowerCase() ?? null);
  // "meta" names the ad platform only; an organic post lives on one app.
  const platform: SocialPlatform | null = rawPlatform === "meta" ? null : rawPlatform;
  const hasGoogleClick = Boolean(utm.gclid || utm.wbraid || utm.gbraid);

  if (medium && MEDIUM_PROFIL.has(medium)) return { channel: "profil_link", platform };
  if (medium && MEDIUM_DM.has(medium)) return { channel: "dm_link", platform };

  if ((medium && MEDIUM_PAID.has(medium)) || hasGoogleClick) {
    if (rawPlatform === "google" || (hasGoogleClick && !rawPlatform)) {
      return { channel: "google_anzeige", platform: "google" };
    }
    if (rawPlatform === "instagram" || rawPlatform === "facebook" || rawPlatform === "meta") {
      return { channel: "meta_anzeige", platform };
    }
    return { channel: "unbekannt", platform };
  }

  // fbclid alone says nothing: Meta appends it to organic link clicks too.
  if (!medium || MEDIUM_ORGANIC.has(medium)) {
    if (rawPlatform === "instagram") return { channel: "instagram_organisch", platform };
    if (rawPlatform === "facebook") return { channel: "facebook_organisch", platform };
    if (rawPlatform === "tiktok") return { channel: "tiktok_organisch", platform };
  }

  const hasAnyUtm = Object.keys(utm).some((k) => k.startsWith("utm_"));
  return { channel: hasAnyUtm ? "unbekannt" : "direkt", platform };
}

/**
 * Classify one inquiry. The Messweg is decided ONLY by the technical entry
 * point (`source`, written by the receiving system), never by UTM values or
 * by what the person says about how they found the Praxis: self-reported
 * attribution never triggers the first invoice (Kanon 5). UTM only decides the
 * channel and which post the inquiry belongs to.
 */
export function classifyAttribution(input: AttributionInput): Attribution {
  const s = (input.source ?? "").toLowerCase().trim();
  const utm = readUtm(input.utm);
  const campaign = utm.utm_campaign ?? null;
  const post = utm.utm_content ?? null;

  const build = (
    messweg: Messweg | null,
    notMesswegReason: NotMesswegReason | null,
    ch: { channel: AttributionChannel; platform: SocialPlatform | null }
  ): Attribution => ({ ...ch, messweg, notMesswegReason, campaign, post });

  if (ENTRY_FORMULAR.has(s)) return build("formular", null, channelFromUtm(utm));
  if (ENTRY_ANRUF.has(s)) return build("anruf", null, channelFromUtm(utm));
  if (ENTRY_BUCHUNG.has(s)) return build("buchung", null, channelFromUtm(utm));

  if (ENTRY_META_FORM.has(s)) {
    return build(null, "plattform_formular", { channel: "meta_anzeige", platform: null });
  }
  const socialPlatform = ENTRY_SOCIAL_DIRECT[s];
  if (socialPlatform && socialPlatform !== "google") {
    return build(null, "fremde_quelle", {
      channel: SOCIAL_ORGANIC_CHANNEL[socialPlatform],
      platform: socialPlatform,
    });
  }
  if (ENTRY_GOOGLE_FORM.has(s)) {
    return build(null, "plattform_formular", { channel: "google_anzeige", platform: "google" });
  }

  const noChannel = { channel: "unbekannt" as const, platform: null };
  if (ENTRY_MANUELL.has(s)) return build(null, "manueller_eintrag", noChannel);
  if (ENTRY_SELBSTAUSKUNFT.has(s)) return build(null, "selbstauskunft", noChannel);
  if (ENTRY_IMPORT.has(s)) return build(null, "import", noChannel);
  if (ENTRY_FREMD.has(s)) return build(null, "fremde_quelle", noChannel);
  return build(null, "unbekannte_quelle", noChannel);
}

// ---------------------------------------------------------------------------
// Attribution confidence: how sure the portal is about where an inquiry
// came from. Shown next to every total; never a claim of complete organic
// attribution.
// ---------------------------------------------------------------------------

export const ATTRIBUTION_CONFIDENCES = [
  "messweg",
  "plattform",
  "selbstauskunft",
  "praxis_eingabe",
  "unbekannt",
] as const;
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCES)[number];

export const ATTRIBUTION_CONFIDENCE_LABELS: Record<AttributionConfidence, string> = {
  messweg: "EINS-Messweg",
  plattform: "Formular bei Meta oder Google",
  selbstauskunft: "Selbstauskunft",
  praxis_eingabe: "Eingabe der Praxis",
  unbekannt: "Unbekannt",
};

/**
 * "Wie sind Sie auf uns aufmerksam geworden?": closed list, no free text, so
 * no health data can land there. `anruf_praxis` only exists in the front-desk
 * entry ("Anruf in der Praxis"). Never changes `source` or the Messweg.
 */
export const SELF_REPORTED_SOURCES = [
  "instagram",
  "facebook",
  "tiktok",
  "google_suche",
  "empfehlung",
  "sonstiges",
  "anruf_praxis",
] as const;
export type SelfReportedSource = (typeof SELF_REPORTED_SOURCES)[number];

export const SELF_REPORTED_SOURCE_LABELS: Record<SelfReportedSource, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_suche: "Google-Suche",
  empfehlung: "Empfehlung",
  sonstiges: "Sonstiges",
  anruf_praxis: "Anruf in der Praxis",
};

export function parseSelfReportedSource(raw: unknown): SelfReportedSource | null {
  return typeof raw === "string" && (SELF_REPORTED_SOURCES as readonly string[]).includes(raw)
    ? (raw as SelfReportedSource)
    : null;
}

/**
 * Confidence for one inquiry, decided by the entry point only:
 *   messweg         EINS-Messweg (form on a Zielseite, tracking number, booking link)
 *   plattform       instant form at Meta or Google
 *   praxis_eingabe  entered by the Praxis team
 *   selbstauskunft  only what the person said ("Empfehlung", the self-report question)
 *   unbekannt       everything else (WhatsApp, PVS import, unknown values)
 * A self-report never upgrades or downgrades a Messweg or a Praxis entry; it
 * only replaces "unbekannt". Keep in sync with the backfill in migration 0097.
 */
export function attributionConfidence(input: {
  source: string | null | undefined;
  selfReportedSource?: string | null;
}): AttributionConfidence {
  const a = classifyAttribution({ source: input.source });
  if (a.messweg) return "messweg";
  switch (a.notMesswegReason) {
    case "plattform_formular":
      return "plattform";
    case "manueller_eintrag":
      return "praxis_eingabe";
    case "selbstauskunft":
      return "selbstauskunft";
    default:
      return parseSelfReportedSource(input.selfReportedSource) ? "selbstauskunft" : "unbekannt";
  }
}

// ---------------------------------------------------------------------------
// Reporting buckets (forecast, Auswertung "Quellen")
// ---------------------------------------------------------------------------

/**
 * One bucket per inquiry for reports. The channels from classifyAttribution
 * come first (paid and organic side by side), followed by buckets for entry
 * points that carry no channel.
 */
export const REPORTING_CHANNELS = [
  ...ATTRIBUTION_CHANNELS.filter((c) => c !== "unbekannt"),
  "manuell",
  "whatsapp",
  "empfehlung",
  "pvs_import",
  "unbekannt",
] as const;

export type ReportingChannel = AttributionChannel | "manuell" | "whatsapp" | "empfehlung" | "pvs_import";

export const REPORTING_CHANNEL_LABELS: Record<ReportingChannel, string> = {
  ...ATTRIBUTION_CHANNEL_LABELS,
  manuell: "Manueller Eintrag",
  whatsapp: "WhatsApp",
  empfehlung: "Empfehlung",
  pvs_import: "PVS-Import",
};

/** Label for a bucket key; falls back to the key for anything unexpected. */
export function reportingChannelLabel(key: string): string {
  return (REPORTING_CHANNEL_LABELS as Record<string, string>)[key] ?? key;
}

export function reportingChannel(input: AttributionInput): ReportingChannel {
  const a = classifyAttribution(input);
  if (a.messweg || a.notMesswegReason === "plattform_formular") return a.channel;
  switch (a.notMesswegReason) {
    case "manueller_eintrag":
      return "manuell";
    case "selbstauskunft":
      return "empfehlung";
    case "import":
      return "pvs_import";
    case "fremde_quelle": {
      if (a.channel !== "unbekannt") return a.channel;
      const s = (input.source ?? "").toLowerCase().trim();
      return s === "whatsapp" || s === "wa" ? "whatsapp" : "unbekannt";
    }
    default:
      return "unbekannt";
  }
}

/**
 * Channel and post code a patient keeps from its first-touch Anfrage
 * (patients.first_touch_channel / first_touch_content_code). The raw source
 * alone loses the UTMs, so an organic profile-link patient looked "direkt".
 */
export function firstTouchFields(source: string, utm: unknown): {
  firstTouchChannel: ReportingChannel;
  firstTouchContentCode: string | null;
} {
  return {
    firstTouchChannel: reportingChannel({ source, utm }),
    firstTouchContentCode: readUtm(utm).utm_content?.slice(0, 200) ?? null,
  };
}

/** Ad platform whose spend belongs to this bucket, if any. */
export function adPlatformFor(channel: string): "meta" | "google" | null {
  if (channel === "meta_anzeige") return "meta";
  if (channel === "google_anzeige") return "google";
  return null;
}
export type ForecastSource = ReportingChannel;

/**
 * Normalize an inquiry into its reporting bucket. Pass the UTM bag whenever
 * the caller has it: without it, every Zielseite form lands in "direkt".
 */
export function canonicalSource(raw: string | null | undefined, utm?: unknown): ReportingChannel {
  return reportingChannel({ source: raw, utm });
}
