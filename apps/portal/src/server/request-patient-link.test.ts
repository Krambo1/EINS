import { describe, expect, it } from "vitest";
import {
  firstTouchAfterAttach,
  phoneKey,
  requestMatchesPatient,
  type LinkablePatient,
  type LinkableRequest,
} from "./request-patient-link";

/**
 * Pass 2: requests.patient_id was never written in production, so no Anfrage
 * ever got PVS status, revenue or a Purchase. These pin the rule that now
 * attaches an Anfrage to the PVS-derived patient.
 */

const patient = (over: Partial<LinkablePatient> = {}): LinkablePatient => ({
  email: "anna.schmidt@example.de",
  phone: "+49 171 2345678",
  fullName: "Anna Schmidt",
  phoneUnique: true,
  ...over,
});

const lead = (over: Partial<LinkableRequest> = {}): LinkableRequest => ({
  contactName: "Anna Schmidt",
  contactEmail: "Anna.Schmidt@Example.de",
  contactPhone: null,
  status: "neu",
  ...over,
});

describe("phoneKey", () => {
  it("matches German mobile numbers across +49 and 0 prefixes", () => {
    expect(phoneKey("+49 171 2345678")).toBe(phoneKey("0171/2345678"));
    expect(phoneKey("0049 (171) 234-5678")).toBe(phoneKey("01712345678"));
  });
  it("refuses numbers too short to identify anyone", () => {
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
});

describe("requestMatchesPatient", () => {
  it("links on the same email (case-insensitive) with a compatible name", () => {
    expect(requestMatchesPatient(lead(), patient())).toBe("email");
  });

  it("links on the same email when the Anfrage has no name", () => {
    expect(requestMatchesPatient(lead({ contactName: null }), patient())).toBe(
      "email"
    );
  });

  it("does not link a shared family email with a different last name", () => {
    expect(
      requestMatchesPatient(lead({ contactName: "Peter Meier" }), patient())
    ).toBeNull();
  });

  it("links on the same phone (last 9 digits) when both names agree", () => {
    expect(
      requestMatchesPatient(
        lead({ contactEmail: "other@example.de", contactPhone: "0171 2345678" }),
        patient({ email: null })
      )
    ).toBe("phone");
  });

  it("does not link on phone when a name is unknown", () => {
    expect(
      requestMatchesPatient(
        lead({ contactEmail: null, contactPhone: "01712345678", contactName: null }),
        patient({ email: null })
      )
    ).toBeNull();
    expect(
      requestMatchesPatient(
        lead({ contactEmail: null, contactPhone: "01712345678" }),
        patient({ email: null, fullName: null })
      )
    ).toBeNull();
  });

  it("does not link on phone when another patient shares the number", () => {
    expect(
      requestMatchesPatient(
        lead({ contactEmail: null, contactPhone: "01712345678" }),
        patient({ email: null, phoneUnique: false })
      )
    ).toBeNull();
  });

  it("does not link on phone when the names contradict", () => {
    expect(
      requestMatchesPatient(
        lead({ contactEmail: null, contactPhone: "01712345678", contactName: "Lea Wagner" }),
        patient({ email: null })
      )
    ).toBeNull();
  });

  it("never links a spam Anfrage", () => {
    expect(requestMatchesPatient(lead({ status: "spam" }), patient())).toBeNull();
  });
});

describe("firstTouchAfterAttach", () => {
  const created = new Date("2026-05-10T10:00:00Z");

  it("a bridge-created patient takes the source of an older Anfrage", () => {
    expect(
      firstTouchAfterAttach("pvs", created, [
        { source: "formular", createdAt: new Date("2026-05-09T08:00:00Z") },
        { source: "meta_lead", createdAt: new Date("2026-05-01T08:00:00Z") },
      ])
    ).toBe("meta_lead");
  });

  it("an Anfrage newer than the patient row is not the first touch", () => {
    expect(
      firstTouchAfterAttach("pvs", created, [
        { source: "formular", createdAt: new Date("2026-06-01T08:00:00Z") },
      ])
    ).toBe("pvs");
  });

  it("pass 2 (verifier): a patient with PVS activity before the Anfrage stays 'pvs' (existing patient, not acquired)", () => {
    // Portal row created at bridge go-live, so the Anfrage is older than the
    // row; but the PVS has invoices from 2019. Moving first touch to the lead
    // would put years of lifetime value on the lead's channel.
    expect(
      firstTouchAfterAttach(
        "pvs",
        created,
        [{ source: "meta_lead", createdAt: new Date("2026-05-01T08:00:00Z") }],
        new Date("2019-03-01T08:00:00Z")
      )
    ).toBe("pvs");
    // First PVS activity after the Anfrage (1 day slack): acquired via the lead.
    expect(
      firstTouchAfterAttach(
        "pvs",
        created,
        [{ source: "meta_lead", createdAt: new Date("2026-05-01T08:00:00Z") }],
        new Date("2026-04-30T20:00:00Z")
      )
    ).toBe("meta_lead");
  });

  it("a real first-touch source is never overwritten", () => {
    expect(
      firstTouchAfterAttach("google_ads", created, [
        { source: "formular", createdAt: new Date("2026-01-01T08:00:00Z") },
      ])
    ).toBe("google_ads");
  });
});
