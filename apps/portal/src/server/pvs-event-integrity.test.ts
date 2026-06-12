import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  computePvsEventIntegrityTag,
  verifyPvsEventIntegrityTag,
} from "./pvs-event-integrity";

/**
 * H3 regression: the replay tool re-verifies this server-side tag before
 * re-applying a stored pvs_event_log row. The guarantee that must hold:
 *  - the tag computed at ingest (over the in-memory envelope) verifies against
 *    the SAME payload after a JSONB round-trip (key reorder + reparse), so an
 *    untampered row never false-positives as "integrity_failed";
 *  - any change to a payload value flips verification to false.
 */

// A representative canonical envelope (string scalars, an int, nested object).
const envelope = {
  clinicId: "11111111-1111-1111-1111-111111111111",
  bridgeSource: "gdt_agent",
  pvsExternalEventId: "evt-abc-123",
  kind: "InvoicePaid",
  occurredAt: "2026-06-11T10:00:00.000Z",
  amountCents: 12_345,
  patient: { pvsPatientId: "p-9", externalId: "X-7" },
};

/** Simulate what Postgres JSONB does on the way back out: reparse, lose key order. */
function jsonbRoundTrip<T>(v: T): T {
  const reordered = JSON.parse(JSON.stringify(v));
  // Force a different key order than the original object literal.
  const shuffled: Record<string, unknown> = {};
  for (const k of Object.keys(reordered).reverse()) shuffled[k] = reordered[k];
  return shuffled as T;
}

describe("pvs-event-integrity", () => {
  it("verifies a tag across the JSONB round-trip (no false positive)", () => {
    const tag = computePvsEventIntegrityTag(envelope);
    const roundTripped = jsonbRoundTrip(envelope);
    expect(verifyPvsEventIntegrityTag(roundTripped, tag)).toBe(true);
  });

  it("canonical form is invariant to key order", () => {
    expect(canonicalJson(envelope)).toBe(canonicalJson(jsonbRoundTrip(envelope)));
  });

  it("detects a tampered scalar", () => {
    const tag = computePvsEventIntegrityTag(envelope);
    const tampered = { ...envelope, amountCents: 999_999 };
    expect(verifyPvsEventIntegrityTag(tampered, tag)).toBe(false);
  });

  it("detects a tampered nested value", () => {
    const tag = computePvsEventIntegrityTag(envelope);
    const tampered = {
      ...envelope,
      patient: { ...envelope.patient, pvsPatientId: "p-EVIL" },
    };
    expect(verifyPvsEventIntegrityTag(tampered, tag)).toBe(false);
  });

  it("rejects a garbage / wrong-length tag without throwing", () => {
    expect(verifyPvsEventIntegrityTag(envelope, "")).toBe(false);
    expect(verifyPvsEventIntegrityTag(envelope, "deadbeef")).toBe(false);
  });
});
