import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eligibleInquiries } from "./guarantee-clock";
import { toE164, utmForBookingLink, utmForTrackingNumber, pickUtm } from "./messweg";
import { CALENDLY_TOLERANCE_MS, calendlyAdapter, fixtureAdapter, matelsoAdapter } from "./messweg-adapters";
import { attributionConfidence, classifyAttribution } from "./sources";

const NOW = new Date("2026-10-08T10:00:00Z");

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

describe("toE164", () => {
  it("normalises German numbers", () => {
    expect(toE164("0221 123 456 78")).toBe("+4922112345678");
    expect(toE164("+49 (221) 1234-5678")).toBe("+4922112345678");
    expect(toE164("0049221123456")).toBe("+49221123456");
    expect(toE164("4922112345678")).toBe("+4922112345678");
    expect(toE164("anonym")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("utm from number or link", () => {
  it("gives a profile number the profile-link channel", () => {
    const utm = utmForTrackingNumber("profil", {});
    expect(classifyAttribution({ source: "anruf", utm })).toMatchObject({
      messweg: "anruf",
      channel: "profil_link",
      platform: "instagram",
    });
  });
  it("lets provider UTM (dynamic number on the Zielseite) win", () => {
    const utm = utmForTrackingNumber("zielseite", { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" });
    expect(classifyAttribution({ source: "anruf", utm })).toMatchObject({ channel: "dm_link", post: "b7k2x" });
  });
  it("a Zielseite number without UTM stays direkt", () => {
    expect(classifyAttribution({ source: "anruf", utm: utmForTrackingNumber("zielseite", {}) }).channel).toBe("direkt");
  });
  it("maps booking-link media", () => {
    expect(utmForBookingLink("dm", {})).toEqual({ utm_source: "instagram", utm_medium: "dm" });
    expect(utmForBookingLink("zielseite", {})).toEqual({});
  });
  it("pickUtm keeps utm_* strings only and accepts camelCase", () => {
    expect(pickUtm({ utmSource: "instagram", utm_content: " b7k2x ", salesforce_uuid: "x", utm_term: 3 })).toEqual({
      utm_source: "instagram",
      utm_content: "b7k2x",
    });
    expect(pickUtm(null)).toEqual({});
  });
});

describe("matelso adapter", () => {
  const SECRET = "m".repeat(40);
  const body = {
    callId: "call-1",
    calledNumber: "0221 12345678",
    callerNumber: "0171 2345678",
    startedAt: "2026-10-08T09:58:00+02:00",
    durationSec: "42",
    status: "answered",
  };

  it("accepts only the shared token", () => {
    expect(matelsoAdapter.verify("{}", headers({ "x-eins-messweg-token": SECRET }), SECRET, NOW)).toBe(true);
    expect(matelsoAdapter.verify("{}", headers({ "x-eins-messweg-token": "falsch" }), SECRET, NOW)).toBe(false);
    expect(matelsoAdapter.verify("{}", headers({}), SECRET, NOW)).toBe(false);
  });

  it("maps the push to an anruf event", () => {
    const r = matelsoAdapter.parse(body);
    expect(r.type).toBe("event");
    if (r.type !== "event" || r.event.kind !== "anruf") throw new Error("expected anruf");
    expect(r.event).toMatchObject({
      provider: "matelso",
      externalId: "call-1",
      calledNumber: "+4922112345678",
      contactPhone: "+491712345678",
      durationSec: 42,
      callStatus: "angenommen",
    });
  });

  it("ignores a push without a valid called number or id", () => {
    expect(matelsoAdapter.parse({ ...body, calledNumber: "x" }).type).toBe("ignore");
    expect(matelsoAdapter.parse({ ...body, callId: "" }).type).toBe("ignore");
  });
});

describe("calendly adapter", () => {
  const KEY = "calendly-signing-key";
  function sign(raw: string, t: number, key = KEY) {
    return `t=${t},v1=${createHmac("sha256", key).update(`${t}.${raw}`, "utf8").digest("hex")}`;
  }
  const raw = JSON.stringify({
    event: "invitee.created",
    created_at: "2026-10-08T09:59:00.000000Z",
    payload: {
      uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
      name: "Anna Beispiel",
      email: "anna@example.test",
      text_reminder_number: "+49 171 2345678",
      tracking: { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" },
      scheduled_event: {
        event_type: "https://api.calendly.com/event_types/ET1",
        start_time: "2026-10-12T08:00:00.000000Z",
      },
    },
  });
  const t = Math.floor(NOW.getTime() / 1000);

  it("verifies the signature over t.raw", () => {
    expect(calendlyAdapter.verify(raw, headers({ "calendly-webhook-signature": sign(raw, t) }), KEY, NOW)).toBe(true);
  });
  it("rejects a wrong key, a changed body and an old timestamp", () => {
    expect(calendlyAdapter.verify(raw, headers({ "calendly-webhook-signature": sign(raw, t, "anders") }), KEY, NOW)).toBe(false);
    expect(calendlyAdapter.verify(`${raw} `, headers({ "calendly-webhook-signature": sign(raw, t) }), KEY, NOW)).toBe(false);
    const old = t - CALENDLY_TOLERANCE_MS / 1000 - 1;
    expect(calendlyAdapter.verify(raw, headers({ "calendly-webhook-signature": sign(raw, old) }), KEY, NOW)).toBe(false);
    expect(calendlyAdapter.verify(raw, headers({}), KEY, NOW)).toBe(false);
  });
  it("maps invitee.created to a buchung with UTM and appointment", () => {
    const r = calendlyAdapter.parse(JSON.parse(raw));
    if (r.type !== "event" || r.event.kind !== "buchung") throw new Error("expected buchung");
    expect(r.event).toMatchObject({
      externalId: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
      contactEmail: "anna@example.test",
      bookingRef: "https://api.calendly.com/event_types/ET1",
      utm: { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" },
    });
    expect(r.event.appointmentAt?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });
  it("ignores cancellations", () => {
    const body = { ...JSON.parse(raw), event: "invitee.canceled" };
    expect(calendlyAdapter.parse(body)).toEqual({ type: "ignore", reason: "invitee.canceled" });
  });
});

describe("fixture adapter", () => {
  it("checks the HMAC of the raw body", () => {
    const raw = '{"kind":"anruf"}';
    const sig = createHmac("sha256", "fixture-secret-123").update(raw).digest("hex");
    expect(fixtureAdapter.verify(raw, headers({ "x-eins-signature": sig }), "fixture-secret-123", NOW)).toBe(true);
    expect(fixtureAdapter.verify(raw, headers({ "x-eins-signature": sig }), "other-secret-1234", NOW)).toBe(false);
  });
});

describe("Garantie-Uhr counts anruf and buchung as Messweg", () => {
  it("proposes calls and bookings as candidates with Messweg confidence", () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-10-05T10:00:00Z"), source: "anruf", utm: null, contactPhone: "+491712345678" },
      { id: "b", createdAt: new Date("2026-10-06T10:00:00Z"), source: "buchung", utm: null, contactEmail: "a@b.test" },
      { id: "c", createdAt: new Date("2026-10-04T10:00:00Z"), source: "manuell", utm: null, contactPhone: "0171" },
    ];
    const out = eligibleInquiries(rows, { signedOn: "2026-10-01", deadline: "2026-12-30", rejectedIds: new Set() });
    expect(out.map((e) => e.row.id)).toEqual(["a", "b"]);
    expect(out.map((e) => e.attribution.messweg)).toEqual(["anruf", "buchung"]);
    expect(attributionConfidence({ source: "anruf" })).toBe("messweg");
  });
});
