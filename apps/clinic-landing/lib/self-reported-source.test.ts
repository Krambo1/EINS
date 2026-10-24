/**
 * The portal payload carries the self-report only as one of the six allowed
 * values; anything else (incl. the front-desk-only "anruf_praxis") is dropped
 * without touching the rest of the inquiry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapToIntake } from "./portal-intake";
import {
  LANDING_SELF_REPORTED_SOURCES,
  LANDING_SELF_REPORTED_SOURCE_OPTIONS,
  parseLandingSelfReportedSource,
} from "./self-reported-source";
import type { Clinic, QuizSubmissionPayload, Treatment } from "./types";

const clinic = { portalClinicId: "00000000-0000-0000-0000-000000000001" } as unknown as Clinic;
const treatment = {
  category: "injectables",
  priceRange: { fromCents: 30000 },
} as unknown as Treatment;

function payload(selfReportedSource?: string): QuizSubmissionPayload {
  return {
    clinicSlug: "test",
    treatmentSlug: "test",
    branch: "qualified",
    treatment: "Test",
    email: "anna@example.test",
    phone: "+491711112222",
    firstName: "Anna",
    selfReportedSource,
    consents: { privacy: true, ageGate: true, marketing: false, aiProcessing: false },
    marketingConfirmedAt: null,
    meta: { eventId: "evt-1", sourceUrl: "https://example.test/" },
  } as QuizSubmissionPayload;
}

test("the list is exactly the six landing values, no front-desk value", () => {
  assert.deepEqual(
    [...LANDING_SELF_REPORTED_SOURCES],
    ["instagram", "facebook", "tiktok", "google_suche", "empfehlung", "sonstiges"],
  );
  assert.deepEqual(
    LANDING_SELF_REPORTED_SOURCE_OPTIONS.map((o) => o.id),
    [...LANDING_SELF_REPORTED_SOURCES],
  );
  assert.equal(parseLandingSelfReportedSource("anruf_praxis"), undefined);
});

test("every allowed value reaches the portal payload unchanged", () => {
  for (const value of LANDING_SELF_REPORTED_SOURCES) {
    assert.equal(mapToIntake(payload(value), clinic, treatment).selfReportedSource, value);
  }
});

test("skipped, unknown or free-text values never reach the portal", () => {
  for (const value of [undefined, "", "anruf_praxis", "Instagram", "meine Freundin", "x".repeat(40)]) {
    const body = mapToIntake(payload(value), clinic, treatment);
    assert.equal(body.selfReportedSource, undefined);
    assert.equal("selfReportedSource" in JSON.parse(JSON.stringify(body)), false);
    // The inquiry itself is untouched.
    assert.equal(body.contactEmail, "anna@example.test");
    assert.equal(body.source, "formular");
  }
});
