/**
 * Provider adapters for the Messweg webhook (/api/webhooks/messweg/[provider]).
 * Pure: each adapter checks the delivery with the secret it is given and maps
 * the payload to one MesswegEvent (lib/messweg.ts). Secrets come from the
 * route (env), never from the payload.
 *
 * matelso   Matelso "Custom Push" (Integrations 2.0). Matelso lets the
 *           customer define the push body freely, so EINS defines it (see
 *           MATELSO_PUSH_TEMPLATE) and Matelso fills it from its data
 *           dictionary. Matelso does not sign pushes; the push sends a shared
 *           token in the header X-EINS-Messweg-Token, compared in constant
 *           time.
 * calendly  Calendly webhook subscription, event invitee.created. Header
 *           Calendly-Webhook-Signature "t=<unix>,v1=<hex>", HMAC-SHA256 of
 *           "<t>.<raw body>" with the subscription's signing key, 180 s
 *           tolerance (developer.calendly.com, checked 08.10.2026).
 * fixture   tests and local runs only: the body IS the event, HMAC-SHA256
 *           hex of the raw body in X-EINS-Signature. Never in production.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  pickUtm,
  toE164,
  type AdapterResult,
  type MesswegEvent,
  type MesswegProvider,
} from "./messweg";

export interface MesswegAdapter {
  provider: MesswegProvider;
  /** True when the delivery is authentic. `secret` null = not configured. */
  verify(rawBody: string, headers: Headers, secret: string, now: Date): boolean;
  parse(body: unknown): AdapterResult;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

const capped = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s && s.trim() ? s.trim().slice(0, max) : null));
const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

// ---------------------------------------------------------------------------
// Matelso
// ---------------------------------------------------------------------------

/**
 * The body EINS asks Matelso to push (Custom Push template). Karam maps each
 * field to the matching Matelso data-dictionary key when setting up the push.
 */
export const MATELSO_PUSH_TEMPLATE = {
  callId: "<eindeutige Anruf-ID>",
  calledNumber: "<angerufene EINS-Tracking-Nummer, E.164>",
  callerNumber: "<Nummer der anrufenden Person>",
  startedAt: "<Beginn, ISO 8601 mit Zeitzone>",
  durationSec: "<Gesprächsdauer in Sekunden>",
  status: "<answered | missed | busy>",
  utm: { utm_source: "<optional>", utm_medium: "<optional>", utm_content: "<optional>" },
} as const;

const MatelsoBody = z.object({
  callId: capped(200).pipe(z.string().min(1)),
  calledNumber: z.string(),
  callerNumber: optionalText(64),
  startedAt: isoDate,
  durationSec: z.coerce.number().int().nonnegative().nullish().catch(null),
  status: z.string().nullish(),
  utm: z.unknown().optional(),
});

const MATELSO_STATUS: Record<string, "angenommen" | "verpasst" | "besetzt"> = {
  answered: "angenommen",
  missed: "verpasst",
  busy: "besetzt",
};

export const matelsoAdapter: MesswegAdapter = {
  provider: "matelso",
  verify(_raw, headers, secret) {
    const token = headers.get("x-eins-messweg-token");
    return !!token && safeEqual(token, secret);
  },
  parse(body) {
    const r = MatelsoBody.safeParse(body);
    if (!r.success) return { type: "ignore", reason: "ungueltige_nutzlast" };
    const calledNumber = toE164(r.data.calledNumber);
    if (!calledNumber) return { type: "ignore", reason: "ungueltige_nummer" };
    const event: MesswegEvent = {
      kind: "anruf",
      provider: "matelso",
      externalId: r.data.callId,
      occurredAt: r.data.startedAt,
      contactName: null,
      contactEmail: null,
      contactPhone: toE164(r.data.callerNumber) ?? r.data.callerNumber,
      utm: pickUtm(r.data.utm),
      calledNumber,
      durationSec: r.data.durationSec ?? null,
      callStatus: MATELSO_STATUS[(r.data.status ?? "").toLowerCase()] ?? "unbekannt",
    };
    return { type: "event", event };
  },
};

// ---------------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------------

export const CALENDLY_TOLERANCE_MS = 180_000;

const CalendlyBody = z.object({
  event: z.string(),
  created_at: z.string().optional(),
  payload: z
    .object({
      uri: capped(500).pipe(z.string().min(1)),
      name: optionalText(200),
      email: z.string().trim().email().max(254).nullish().catch(null),
      text_reminder_number: optionalText(64),
      created_at: z.string().optional(),
      tracking: z.unknown().optional(),
      scheduled_event: z.object({
        event_type: capped(500).pipe(z.string().min(1)),
        start_time: isoDate.nullish().catch(null),
      }),
    })
    .passthrough(),
});

export const calendlyAdapter: MesswegAdapter = {
  provider: "calendly",
  verify(raw, headers, secret, now) {
    const header = headers.get("calendly-webhook-signature");
    if (!header) return false;
    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      })
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1 || !/^\d+$/.test(t)) return false;
    if (Math.abs(now.getTime() - Number(t) * 1000) > CALENDLY_TOLERANCE_MS) return false;
    return safeEqual(hmacHex(secret, `${t}.${raw}`), v1);
  },
  parse(body) {
    const r = CalendlyBody.safeParse(body);
    if (!r.success) return { type: "ignore", reason: "ungueltige_nutzlast" };
    if (r.data.event !== "invitee.created") return { type: "ignore", reason: r.data.event };
    const p = r.data.payload;
    const createdAt = p.created_at ?? r.data.created_at;
    const occurredAt = createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt) : new Date();
    const event: MesswegEvent = {
      kind: "buchung",
      provider: "calendly",
      externalId: p.uri,
      occurredAt,
      contactName: p.name,
      contactEmail: p.email ?? null,
      contactPhone: p.text_reminder_number,
      // Calendly's tracking object; snake_case and camelCase both accepted.
      utm: pickUtm(p.tracking),
      bookingRef: p.scheduled_event.event_type,
      appointmentAt: p.scheduled_event.start_time ?? null,
    };
    return { type: "event", event };
  },
};

// ---------------------------------------------------------------------------
// Fixture (tests, local runs)
// ---------------------------------------------------------------------------

const FixtureBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anruf"),
    externalId: capped(200).pipe(z.string().min(1)),
    occurredAt: isoDate,
    contactName: optionalText(200),
    contactEmail: optionalText(254),
    contactPhone: optionalText(64),
    utm: z.unknown().optional(),
    calledNumber: z.string(),
    durationSec: z.number().int().nonnegative().nullish(),
  }),
  z.object({
    kind: z.literal("buchung"),
    externalId: capped(200).pipe(z.string().min(1)),
    occurredAt: isoDate,
    contactName: optionalText(200),
    contactEmail: optionalText(254),
    contactPhone: optionalText(64),
    utm: z.unknown().optional(),
    bookingRef: capped(500),
    appointmentAt: isoDate.nullish(),
  }),
]);

export const fixtureAdapter: MesswegAdapter = {
  provider: "fixture",
  verify(raw, headers, secret) {
    const sig = headers.get("x-eins-signature");
    return !!sig && safeEqual(sig, hmacHex(secret, raw));
  },
  parse(body) {
    const r = FixtureBody.safeParse(body);
    if (!r.success) return { type: "ignore", reason: "ungueltige_nutzlast" };
    const d = r.data;
    const base = {
      provider: "fixture" as const,
      externalId: d.externalId,
      occurredAt: d.occurredAt,
      contactName: d.contactName,
      contactEmail: d.contactEmail,
      contactPhone: d.contactPhone,
      utm: pickUtm(d.utm),
    };
    if (d.kind === "anruf") {
      const calledNumber = toE164(d.calledNumber);
      if (!calledNumber) return { type: "ignore", reason: "ungueltige_nummer" };
      return {
        type: "event",
        event: { ...base, kind: "anruf", calledNumber, durationSec: d.durationSec ?? null, callStatus: "angenommen" },
      };
    }
    return {
      type: "event",
      event: { ...base, kind: "buchung", bookingRef: d.bookingRef, appointmentAt: d.appointmentAt ?? null },
    };
  },
};

export const MESSWEG_ADAPTERS: Record<MesswegProvider, MesswegAdapter> = {
  matelso: matelsoAdapter,
  calendly: calendlyAdapter,
  fixture: fixtureAdapter,
};
