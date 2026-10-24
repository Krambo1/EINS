import { describe, expect, it } from "vitest";
import { recipientsOf, suppressionReasonFor } from "./classify";

// Shape of Resend's documented email.bounced example (SES-style casing).
const bounced = {
  type: "email.bounced",
  created_at: "2026-10-07T08:01:12.126Z",
  data: {
    created_at: "2026-10-07T08:01:10.000Z",
    email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
    from: "\"Praxis Dr. Beispiel via EINS\" <team@eins.ag>",
    to: ["Patientin@Example.de"],
    subject: "Wie war Ihr Besuch bei Praxis Dr. Beispiel?",
    bounce: {
      message:
        "The recipient's email address is on the suppression list because it has a recent history of producing hard bounces.",
      subType: "Suppressed",
      type: "Permanent",
    },
  },
};

describe("resend webhook classification", () => {
  it("treats a capitalized Permanent bounce as hard (E-06)", () => {
    expect(suppressionReasonFor(bounced)).toBe("bounced");
    expect(recipientsOf(bounced)).toEqual(["patientin@example.de"]);
  });

  it("ignores an explicit transient bounce, any casing", () => {
    const e = { ...bounced, data: { ...bounced.data, bounce: { type: "Transient" } } };
    expect(suppressionReasonFor(e)).toBeNull();
  });

  it("treats a bounce without type as hard", () => {
    const e = { ...bounced, data: { ...bounced.data, bounce: undefined } };
    expect(suppressionReasonFor(e)).toBe("bounced");
  });

  it("complaints suppress, other events do not", () => {
    expect(suppressionReasonFor({ type: "email.complained", data: { to: ["a@b.de"] } })).toBe(
      "complained"
    );
    expect(suppressionReasonFor({ type: "email.delivered" })).toBeNull();
    expect(suppressionReasonFor({ type: "email.delivery_delayed" })).toBeNull();
  });

  it("normalizes display-name recipients and strings", () => {
    expect(recipientsOf({ data: { to: "Anna <Anna@X.de>" } })).toEqual(["anna@x.de"]);
  });
});
