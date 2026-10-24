import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_CONFIDENCES,
  ENTRY_SOURCE_ALIASES,
  ENTRY_SOURCE_LABELS,
  ENTRY_SOURCES,
  SELF_REPORTED_SOURCES,
  adPlatformFor,
  attributionConfidence,
  canonicalSource,
  classifyAttribution,
  entrySourceLabel,
  firstTouchFields,
  parseEntrySource,
  parseSelfReportedSource,
  readUtm,
  reportingChannel,
} from "./sources";
import { REQUEST_SOURCES, SOURCE_LABELS } from "./constants";
import { FRONT_DESK_SOURCES, INTAKE_SOURCES, WEBHOOK_ONLY_SOURCES, isFrontDeskSource } from "./sources";

describe("classifyAttribution: Messweg", () => {
  it("counts a form on an EINS Zielseite", () => {
    const a = classifyAttribution({ source: "formular", utm: null });
    expect(a.messweg).toBe("formular");
    expect(a.notMesswegReason).toBeNull();
    expect(a.channel).toBe("direkt");
  });

  it("counts a Zielseite form reached via the profile link and keeps the platform", () => {
    const a = classifyAttribution({
      source: "formular",
      utm: { utm_source: "instagram", utm_medium: "profil_link", utm_campaign: "botox" },
    });
    expect(a).toMatchObject({
      messweg: "formular",
      channel: "profil_link",
      platform: "instagram",
      campaign: "botox",
      post: null,
    });
  });

  it("counts a Zielseite form reached via a DM link and traces it to the post", () => {
    const a = classifyAttribution({
      source: "formular",
      utm: { utm_source: "ig", utm_medium: "dm", utm_content: "reel-2026-10-04" },
    });
    expect(a).toMatchObject({ messweg: "formular", channel: "dm_link", platform: "instagram" });
    expect(a.post).toBe("reel-2026-10-04");
  });

  it("counts tracking-number calls and booking-link bookings", () => {
    expect(classifyAttribution({ source: "anruf" }).messweg).toBe("anruf");
    expect(classifyAttribution({ source: "call_tracking" }).messweg).toBe("anruf");
    expect(classifyAttribution({ source: "buchung" }).messweg).toBe("buchung");
    expect(classifyAttribution({ source: "Booking_Link " }).messweg).toBe("buchung");
  });

  it("never counts self-reported or manual attribution, whatever the UTM says", () => {
    const utm = { utm_source: "instagram", utm_medium: "profil_link" };
    expect(classifyAttribution({ source: "empfehlung", utm })).toMatchObject({
      messweg: null,
      notMesswegReason: "selbstauskunft",
    });
    expect(classifyAttribution({ source: "manuell", utm })).toMatchObject({
      messweg: null,
      notMesswegReason: "manueller_eintrag",
    });
  });

  it("does not count Meta or Google instant forms (not on an EINS Zielseite)", () => {
    expect(classifyAttribution({ source: "meta" })).toMatchObject({
      messweg: null,
      notMesswegReason: "plattform_formular",
      channel: "meta_anzeige",
    });
    expect(classifyAttribution({ source: "google" })).toMatchObject({
      messweg: null,
      notMesswegReason: "plattform_formular",
      channel: "google_anzeige",
    });
  });

  it("does not count WhatsApp, the Praxis website, PVS imports or unknown sources", () => {
    expect(classifyAttribution({ source: "whatsapp" }).notMesswegReason).toBe("fremde_quelle");
    expect(classifyAttribution({ source: "website" }).notMesswegReason).toBe("fremde_quelle");
    expect(classifyAttribution({ source: "csv" }).notMesswegReason).toBe("import");
    expect(classifyAttribution({ source: "irgendwas" }).notMesswegReason).toBe("unbekannte_quelle");
    expect(classifyAttribution({ source: null }).notMesswegReason).toBe("unbekannte_quelle");
  });
});

describe("classifyAttribution: channel", () => {
  const ch = (utm: Record<string, string>) =>
    classifyAttribution({ source: "formular", utm }).channel;

  it("recognises organic posts per platform", () => {
    expect(ch({ utm_source: "instagram", utm_medium: "organisch" })).toBe("instagram_organisch");
    expect(ch({ utm_source: "facebook", utm_medium: "organic" })).toBe("facebook_organisch");
    expect(ch({ utm_source: "tiktok" })).toBe("tiktok_organisch");
    expect(ch({ utm_source: "instagram", utm_medium: "organic-social" })).toBe("instagram_organisch");
    expect(ch({ utm_source: "instagram", utm_medium: "profil-link" })).toBe("profil_link");
  });

  it("recognises paid traffic", () => {
    expect(ch({ utm_source: "facebook", utm_medium: "anzeige" })).toBe("meta_anzeige");
    expect(ch({ utm_source: "meta", utm_medium: "paid_social" })).toBe("meta_anzeige");
    expect(ch({ utm_source: "meta", utm_medium: "paid-social" })).toBe("meta_anzeige");
    expect(ch({ utm_source: "instagram", utm_medium: "Paid Social" })).toBe("meta_anzeige");
    expect(ch({ utm_source: "google", utm_medium: "paid-search", gclid: "g" })).toBe("google_anzeige");
    expect(ch({ utm_source: "google", utm_medium: "cpc" })).toBe("google_anzeige");
    expect(ch({ gclid: "abc" })).toBe("google_anzeige");
  });

  it("does not treat fbclid alone as paid", () => {
    expect(ch({ fbclid: "x" })).toBe("direkt");
    expect(ch({ utm_source: "instagram", fbclid: "x" })).toBe("instagram_organisch");
  });

  it("falls back to unbekannt for UTMs it cannot place", () => {
    expect(ch({ utm_source: "newsletter", utm_medium: "email" })).toBe("unbekannt");
  });
});

describe("readUtm", () => {
  it("ignores non-objects and non-string values", () => {
    expect(readUtm(null)).toEqual({});
    expect(readUtm("x")).toEqual({});
    expect(readUtm(["a"])).toEqual({});
    expect(readUtm({ utm_source: " ig ", n: 3, e: "" })).toEqual({ utm_source: "ig" });
  });
});

describe("reportingChannel / canonicalSource", () => {
  it("keeps organic Instagram and Facebook out of the paid Meta bucket", () => {
    expect(canonicalSource("instagram")).toBe("instagram_organisch");
    expect(canonicalSource("facebook")).toBe("facebook_organisch");
    expect(canonicalSource("tiktok")).toBe("tiktok_organisch");
    expect(canonicalSource("formular", { utm_source: "instagram", utm_medium: "organisch" })).toBe(
      "instagram_organisch"
    );
    expect(canonicalSource("formular", { utm_source: "instagram", utm_medium: "profil_link" })).toBe("profil_link");
  });

  it("puts paid traffic into the paid buckets, whatever the entry point", () => {
    expect(canonicalSource("meta")).toBe("meta_anzeige");
    expect(canonicalSource("formular", { utm_source: "facebook", utm_medium: "anzeige" })).toBe("meta_anzeige");
    expect(canonicalSource("google_form")).toBe("google_anzeige");
    expect(adPlatformFor("meta_anzeige")).toBe("meta");
    expect(adPlatformFor("instagram_organisch")).toBeNull();
  });

  it("maps entry points without a channel to their own buckets", () => {
    expect(reportingChannel({ source: "manuell" })).toBe("manuell");
    expect(reportingChannel({ source: "whatsapp" })).toBe("whatsapp");
    expect(reportingChannel({ source: "referral" })).toBe("empfehlung");
    expect(reportingChannel({ source: "csv" })).toBe("pvs_import");
    expect(reportingChannel({ source: "website" })).toBe("unbekannt");
    expect(reportingChannel({ source: "formular" })).toBe("direkt");
    expect(canonicalSource(null)).toBe("unbekannt");
  });

  it("does not make social-app inquiries a Messweg", () => {
    expect(classifyAttribution({ source: "instagram" })).toMatchObject({
      messweg: null,
      notMesswegReason: "fremde_quelle",
      channel: "instagram_organisch",
    });
  });
});


describe("entry source contract", () => {
  it("is the one vocabulary: constants re-export it", () => {
    expect(REQUEST_SOURCES).toBe(ENTRY_SOURCES);
    expect(SOURCE_LABELS).toBe(ENTRY_SOURCE_LABELS);
    for (const s of ENTRY_SOURCES) expect(ENTRY_SOURCE_LABELS[s]).toBeTruthy();
  });

  it("accepts every entry source and alias, rejects unknown values", () => {
    for (const s of ENTRY_SOURCES) expect(parseEntrySource(s)).toBe(s);
    for (const [alias, s] of Object.entries(ENTRY_SOURCE_ALIASES)) {
      expect(parseEntrySource(alias)).toBe(s);
      expect(ENTRY_SOURCES).toContain(s);
    }
    expect(parseEntrySource("  Call_Tracking ")).toBe("anruf");
    expect(parseEntrySource("landingForm")).toBe("formular");
    expect(parseEntrySource("instagram")).toBeNull();
    expect(parseEntrySource("website")).toBeNull();
    expect(parseEntrySource("")).toBeNull();
    expect(parseEntrySource(null)).toBeNull();
  });

  it("every entry source and alias classifies the same way as its canonical value", () => {
    for (const [alias, s] of Object.entries(ENTRY_SOURCE_ALIASES)) {
      if (alias === "landingform") continue; // only ever stored canonically
      expect(classifyAttribution({ source: alias }).messweg).toBe(classifyAttribution({ source: s }).messweg);
    }
  });

  it("only formular, anruf and buchung are Messwege", () => {
    const messwege = ENTRY_SOURCES.filter((s) => classifyAttribution({ source: s }).messweg !== null);
    expect(messwege).toEqual(["formular", "anruf", "buchung"]);
  });

  it("labels stored values, including old ones", () => {
    expect(entrySourceLabel("anruf")).toBe("Anruf auf EINS-Tracking-Nummer");
    expect(entrySourceLabel("call_tracking")).toBe("Anruf auf EINS-Tracking-Nummer");
    expect(entrySourceLabel("csv")).toBe("csv");
  });
});

describe("attributionConfidence", () => {
  it("derives the confidence from the entry point", () => {
    expect(attributionConfidence({ source: "formular" })).toBe("messweg");
    expect(attributionConfidence({ source: "anruf" })).toBe("messweg");
    expect(attributionConfidence({ source: "buchung" })).toBe("messweg");
    expect(attributionConfidence({ source: "meta" })).toBe("plattform");
    expect(attributionConfidence({ source: "google" })).toBe("plattform");
    expect(attributionConfidence({ source: "manuell" })).toBe("praxis_eingabe");
    expect(attributionConfidence({ source: "empfehlung" })).toBe("selbstauskunft");
    expect(attributionConfidence({ source: "whatsapp" })).toBe("unbekannt");
    expect(attributionConfidence({ source: "pvs_import" })).toBe("unbekannt");
    expect(attributionConfidence({ source: "irgendwas" })).toBe("unbekannt");
  });

  it("covers every entry source with a valid confidence", () => {
    for (const s of ENTRY_SOURCES) {
      expect(ATTRIBUTION_CONFIDENCES).toContain(attributionConfidence({ source: s }));
    }
  });

  it("a self-report never changes a Messweg or a Praxis entry, only replaces unbekannt", () => {
    expect(attributionConfidence({ source: "formular", selfReportedSource: "instagram" })).toBe("messweg");
    expect(attributionConfidence({ source: "manuell", selfReportedSource: "instagram" })).toBe("praxis_eingabe");
    expect(attributionConfidence({ source: "meta", selfReportedSource: "empfehlung" })).toBe("plattform");
    expect(attributionConfidence({ source: "whatsapp", selfReportedSource: "instagram" })).toBe("selbstauskunft");
    expect(attributionConfidence({ source: "whatsapp", selfReportedSource: "erfunden" })).toBe("unbekannt");
  });

  it("self-report is a closed list", () => {
    for (const s of SELF_REPORTED_SOURCES) expect(parseSelfReportedSource(s)).toBe(s);
    expect(parseSelfReportedSource("Instagram")).toBeNull();
    expect(parseSelfReportedSource("habe gelesen, dass ...")).toBeNull();
    expect(parseSelfReportedSource(3)).toBeNull();
  });
});

describe("firstTouchFields", () => {
  it("keeps channel and post code instead of the raw source", () => {
    expect(
      firstTouchFields("formular", { utm_source: "instagram", utm_medium: "dm", utm_content: "b7k2x" })
    ).toEqual({ firstTouchChannel: "dm_link", firstTouchContentCode: "b7k2x" });
    expect(firstTouchFields("meta", null)).toEqual({
      firstTouchChannel: "meta_anzeige",
      firstTouchContentCode: null,
    });
  });
});

describe("intake vs. webhook-only sources", () => {
  it("anruf and buchung come only from the Messweg webhooks", () => {
    expect([...WEBHOOK_ONLY_SOURCES]).toEqual(["anruf", "buchung"]);
    expect([...INTAKE_SOURCES]).toEqual(["formular", "meta", "google", "manuell", "whatsapp", "pvs_import"]);
    for (const s of INTAKE_SOURCES) expect(MESSWEGE_FOR_TEST.has(s) && s !== "formular").toBe(false);
  });
});

const MESSWEGE_FOR_TEST = new Set<string>(["formular", "anruf", "buchung"]);

describe("front-desk sources", () => {
  it("are never a Messweg and always praxis_eingabe", () => {
    for (const source of FRONT_DESK_SOURCES) {
      expect(classifyAttribution({ source, utm: null }).messweg).toBeNull();
      expect(attributionConfidence({ source, selfReportedSource: "instagram" })).toBe("praxis_eingabe");
      expect(isFrontDeskSource(source)).toBe(true);
    }
    expect(isFrontDeskSource("formular")).toBe(false);
    expect(isFrontDeskSource(null)).toBe(false);
  });
});
