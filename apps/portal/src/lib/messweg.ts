/**
 * Messwege "Anruf" and "Buchung" (KANON § 5): the provider-neutral contract.
 * Pure, no DB. Every provider adapter (server/messweg/adapters) maps its
 * webhook payload to one `MesswegEvent`; server/messweg/ingest.ts turns that
 * into a request through persistLead.
 */

export const MESSWEG_PROVIDERS = ["matelso", "calendly", "fixture"] as const;
export type MesswegProvider = (typeof MESSWEG_PROVIDERS)[number];

export function parseMesswegProvider(raw: string): MesswegProvider | null {
  return (MESSWEG_PROVIDERS as readonly string[]).includes(raw) ? (raw as MesswegProvider) : null;
}

export const TRACKING_NUMBER_CHANNELS = ["profil", "zielseite", "meta", "google", "sonstige"] as const;
export type TrackingNumberChannel = (typeof TRACKING_NUMBER_CHANNELS)[number];

export const TRACKING_NUMBER_CHANNEL_LABELS: Record<TrackingNumberChannel, string> = {
  profil: "Instagram-Profil",
  zielseite: "Zielseite",
  meta: "Meta-Anzeige",
  google: "Google-Anzeige",
  sonstige: "Sonstige",
};

export const BOOKING_LINK_MEDIA = ["profil_link", "dm", "zielseite"] as const;
export type BookingLinkMedium = (typeof BOOKING_LINK_MEDIA)[number];

export const BOOKING_LINK_MEDIUM_LABELS: Record<BookingLinkMedium, string> = {
  profil_link: "Profil-Link",
  dm: "Direktnachricht",
  zielseite: "Zielseite",
};

/** Same-person window (KANON § 5: "dieselbe Person ein zweites Mal innerhalb von 30 Tagen"). */
export const SAME_PERSON_DAYS = 30;

/**
 * One call or booking as the provider reported it. Only provider facts: no
 * recording, no free text from the person.
 */
export type MesswegEvent = {
  kind: "anruf" | "buchung";
  provider: MesswegProvider;
  /** Provider's id of the call or booking; the idempotency key with `provider`. */
  externalId: string;
  occurredAt: Date;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** UTM the provider passed through (Calendly tracking, Matelso web data). */
  utm: Record<string, string>;
} & (
  | {
      kind: "anruf";
      /** The EINS tracking number that was called, E.164. */
      calledNumber: string;
      durationSec: number | null;
      /** answered | missed | busy | unknown, as far as the provider says. */
      callStatus: "angenommen" | "verpasst" | "besetzt" | "unbekannt";
    }
  | {
      kind: "buchung";
      /** Provider id of the booking link (Calendly event type URI). */
      bookingRef: string;
      appointmentAt: Date | null;
    }
);

/** What the adapter returns: an event, or a delivery EINS deliberately ignores. */
export type AdapterResult =
  | { type: "event"; event: MesswegEvent }
  | { type: "ignore"; reason: string };

/**
 * German numbers to E.164. Accepts "+49 221 1234567", "0049221...",
 * "0221 1234567". Returns null for anything that is not a plausible number.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s()/.-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+49${s.slice(1)}`;
  else if (/^[1-9]/.test(s)) s = `+${s}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/**
 * UTM a call inherits from the number it came in on, so the channel
 * classifier (lib/sources.ts) sees the same thing it sees for a form.
 * Provider UTM (dynamic number insertion on the Zielseite) wins.
 */
export function utmForTrackingNumber(
  channel: TrackingNumberChannel,
  providerUtm: Record<string, string>
): Record<string, string> {
  if (Object.keys(providerUtm).some((k) => k.startsWith("utm_"))) return providerUtm;
  switch (channel) {
    case "profil":
      return { utm_source: "instagram", utm_medium: "profil_link" };
    case "meta":
      return { utm_source: "facebook", utm_medium: "anzeige" };
    case "google":
      return { utm_source: "google", utm_medium: "anzeige" };
    default:
      return {};
  }
}

/** Same rule for a booking link: provider UTM first, else the link's medium. */
export function utmForBookingLink(
  medium: BookingLinkMedium,
  providerUtm: Record<string, string>
): Record<string, string> {
  if (Object.keys(providerUtm).some((k) => k.startsWith("utm_"))) return providerUtm;
  if (medium === "profil_link") return { utm_source: "instagram", utm_medium: "profil_link" };
  if (medium === "dm") return { utm_source: "instagram", utm_medium: "dm" };
  return {};
}

/** Keep utm_* string values only, capped like the intake route. */
export function pickUtm(bag: unknown): Record<string, string> {
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    const key = k.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (key.startsWith("utm_") && typeof v === "string" && v.trim()) {
      out[key.slice(0, 100)] = v.trim().slice(0, 500);
    }
  }
  return out;
}
