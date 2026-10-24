import { describe, expect, it } from "vitest";
import {
  googlePurchaseSkipReason,
  hasActiveAdsConsent,
  META_PURCHASE_REPORTING,
  metaPurchaseSkipReason,
  type AdsReportGateInput,
} from "./ads-report-gate";

describe("META_PURCHASE_REPORTING", () => {
  it("stays off (owner decision 2026-10-06, Meta account risk)", () => {
    expect(META_PURCHASE_REPORTING).toBe(false);
  });
});

const CONSENT_AT = new Date("2026-10-06T10:00:00Z");
const PAID_META_UTM = { utm_source: "facebook", utm_medium: "anzeige", utm_campaign: "botox" };

function req(overrides: Partial<AdsReportGateInput> = {}): AdsReportGateInput {
  return {
    source: "formular",
    utm: PAID_META_UTM,
    adsConsentAt: CONSENT_AT,
    adsConsentRevokedAt: null,
    contactEmail: "patientin@example.de",
    contactPhone: "+491701234567",
    fbc: null,
    fbclid: null,
    gclid: null,
    wbraid: null,
    gbraid: null,
    ...overrides,
  };
}

describe("hasActiveAdsConsent", () => {
  it("is false without consent, true with it, false once revoked", () => {
    expect(hasActiveAdsConsent({ adsConsentAt: null, adsConsentRevokedAt: null })).toBe(false);
    expect(hasActiveAdsConsent({ adsConsentAt: CONSENT_AT, adsConsentRevokedAt: null })).toBe(true);
    expect(
      hasActiveAdsConsent({ adsConsentAt: CONSENT_AT, adsConsentRevokedAt: new Date() })
    ).toBe(false);
  });
});

describe("metaPurchaseSkipReason", () => {
  it("sends for a paid Meta ad with active consent", () => {
    expect(metaPurchaseSkipReason(req())).toBeNull();
  });

  it("accepts the meta / instagram paid aliases", () => {
    expect(
      metaPurchaseSkipReason(req({ utm: { utm_source: "meta", utm_medium: "paid_social" } }))
    ).toBeNull();
    expect(
      metaPurchaseSkipReason(req({ utm: { utm_source: "instagram", utm_medium: "cpc" } }))
    ).toBeNull();
  });

  it("skips without consent even for a paid Meta ad", () => {
    expect(metaPurchaseSkipReason(req({ adsConsentAt: null }))).toBe("no_ads_consent");
  });

  it("skips once the consent was revoked", () => {
    expect(
      metaPurchaseSkipReason(req({ adsConsentRevokedAt: new Date("2026-10-07T08:00:00Z") }))
    ).toBe("no_ads_consent");
  });

  it("skips an organic Instagram visit even with fbclid and fbc", () => {
    expect(
      metaPurchaseSkipReason(
        req({
          utm: { utm_source: "instagram", utm_medium: "organisch", fbclid: "IwAR123" },
          fbclid: "IwAR123",
          fbc: "fb.1.1700000000000.IwAR123",
        })
      )
    ).toBe("not_meta_ad");
  });

  it("skips fbclid alone without any UTM", () => {
    expect(
      metaPurchaseSkipReason(req({ utm: { fbclid: "IwAR123" }, fbclid: "IwAR123" }))
    ).toBe("not_meta_ad");
  });

  it("skips a Google ad visit for Meta", () => {
    expect(
      metaPurchaseSkipReason(req({ utm: { gclid: "Cj0KCQ" }, gclid: "Cj0KCQ" }))
    ).toBe("not_meta_ad");
  });

  it("skips a Meta Lead Gen form (never carries consent)", () => {
    expect(metaPurchaseSkipReason(req({ source: "meta", utm: null, adsConsentAt: null }))).toBe(
      "no_ads_consent"
    );
  });

  it("skips when Meta has nothing to match on", () => {
    expect(metaPurchaseSkipReason(req({ contactEmail: null, contactPhone: null }))).toBe(
      "no_meta_identifier"
    );
  });
});

describe("googlePurchaseSkipReason", () => {
  it("sends with active consent and a gclid", () => {
    expect(googlePurchaseSkipReason(req({ utm: null, gclid: "Cj0KCQ" }))).toBeNull();
  });

  it("accepts wbraid / gbraid as click id", () => {
    expect(googlePurchaseSkipReason(req({ wbraid: "w1" }))).toBeNull();
    expect(googlePurchaseSkipReason(req({ gbraid: "g1" }))).toBeNull();
  });

  it("skips without a Google click id", () => {
    expect(googlePurchaseSkipReason(req({ utm: { utm_source: "google", utm_medium: "cpc" } }))).toBe(
      "no_google_click_id"
    );
  });

  it("checks consent first: no consent with gclid", () => {
    expect(googlePurchaseSkipReason(req({ gclid: "Cj0KCQ", adsConsentAt: null }))).toBe(
      "no_ads_consent"
    );
  });

  it("skips a revoked consent with gclid", () => {
    expect(
      googlePurchaseSkipReason(req({ gclid: "Cj0KCQ", adsConsentRevokedAt: new Date() }))
    ).toBe("no_ads_consent");
  });
});
