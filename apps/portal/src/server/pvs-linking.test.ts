import { describe, expect, it } from "vitest";
import { chooseAutoAcceptCandidate } from "./pvs-linking";
import type { LinkCandidate } from "./pvs-linking";

/**
 * P1-1 adversarial fixture suite.
 *
 * The previous linker auto-accepted any candidate with combined score
 * >= 0.85. That threshold could be reached by name-trigram + dob + phone-
 * trigram alone, so two patients named "Maria Müller" born the same year
 * whose phones share digits could silently merge — permanently mis-
 * attributing revenue and ad-conversion fanout to the wrong lead.
 *
 * The post-P1-1 rule (encoded in `chooseAutoAcceptCandidate`):
 *
 *   Auto-accept ONLY when exactly one candidate has email-exact match
 *   with the event's email AND its score is >= 1.0. Everything else
 *   (zero email-exact, multiple email-exact, fuzzy-only at any score) is
 *   routed to the operator review queue via linking_failures.
 *
 * The fixtures below intentionally hit the historically-broken cases.
 * Any fixture that the linker would have mis-merged at 0.85 must now
 * return null (no auto-accept) — that's the CI gate.
 */

/** Convenience: a candidate constructor with sensible defaults. */
function cand(
  patientId: string,
  score: number,
  isEmailExact: boolean,
  reason = "fuzzy"
): LinkCandidate {
  return { patientId, score, isEmailExact, reason };
}

describe("chooseAutoAcceptCandidate (P1-1)", () => {
  describe("clear auto-accepts", () => {
    it("one candidate, email-exact, score 1.0 → auto-accept", () => {
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 1.0, true, "email exact"),
      ]);
      expect(winner?.patientId).toBe("p-1");
    });

    it("multiple candidates, only one with email-exact → auto-accept that one", () => {
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 1.0, true, "email exact"),
        cand("p-2", 0.62, false, "fuzzy: name+phone"),
        cand("p-3", 0.42, false, "fuzzy: phone"),
      ]);
      expect(winner?.patientId).toBe("p-1");
    });

    it("email-exact + other signals all agree (score capped at 1.0) → auto-accept", () => {
      // raw_score in production is email(1.0) + phone-exact(0.8) + dob(0.2)
      // = 2.0, capped at 1.0. isEmailExact still true; auto-accept stands.
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 1.0, true, "email exact + phone-exact + dob"),
      ]);
      expect(winner?.patientId).toBe("p-1");
    });
  });

  describe("ambiguity and data-quality issues", () => {
    it("two patients with email-exact (DB collision) → route to review", () => {
      // Real-world cause: legacy data, or a patient who registered twice
      // with the same email and the de-dupe migration hasn't run yet.
      // We refuse to pick one; the operator merges.
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 1.0, true, "email exact"),
        cand("p-2", 1.0, true, "email exact"),
      ]);
      expect(winner).toBeNull();
    });

    it("three patients with email-exact → route to review", () => {
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 1.0, true),
        cand("p-2", 1.0, true),
        cand("p-3", 1.0, true),
      ]);
      expect(winner).toBeNull();
    });
  });

  describe("the 'Maria Müller' adversarial set (this is what 0.85 silently merged)", () => {
    // Each entry below mirrors a real PVS scenario where the OLD threshold
    // would have auto-accepted. Now they all route to review.

    it("two Maria Müllers same DOB, phones share 6 digits → no auto-accept", () => {
      // phone trigram ~0.6 → 0.55 score band
      // name trigram on identical "Maria Müller" → 0.40 (top of band)
      // dob exact → +0.20
      // total raw_score ≈ 1.15 → capped to 1.0
      // OLD behaviour: would have auto-accepted the older record.
      // NEW behaviour: no email-exact → route to review.
      const winner = chooseAutoAcceptCandidate([
        cand("maria-mueller-A", 1.0, false, "fuzzy: phone+name+dob"),
        cand("maria-mueller-B", 0.95, false, "fuzzy: phone+name+dob"),
      ]);
      expect(winner).toBeNull();
    });

    it("Maria Müller vs Maria Müller-Schmidt, same DOB → no auto-accept", () => {
      // name trigram between "Maria Müller" and "Maria Müller-Schmidt" is
      // typically ~0.65–0.75 in PG with the suffix penalty. dob match
      // adds 0.20. Without phone or email, raw_score in [0.5, 0.6] — the
      // old threshold sent this to review anyway, but if the patient
      // happens to have a partial-match phone too, the OLD code crosses
      // 0.85. NEW behaviour: review regardless.
      const winner = chooseAutoAcceptCandidate([
        cand("mueller-maria", 0.92, false, "fuzzy: phone-trig+name+dob"),
      ]);
      expect(winner).toBeNull();
    });

    it("phone-exact + name-fuzzy + dob (no email) at score 1.0 → no auto-accept", () => {
      // OLD behaviour: auto-accept (score >= 0.85). NEW: refused; the
      // patient might be a roommate / family member sharing the phone.
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 1.0, false, "phone-exact + name + dob"),
      ]);
      expect(winner).toBeNull();
    });

    it("the PVS event has NO email; only fuzzy signals returned → no auto-accept", () => {
      // Common in older Praxis-Software exports that don't include email
      // at all. We never auto-accept anything in this scenario; the new
      // PVS patient is created fresh and the operator reviews candidates.
      const winner = chooseAutoAcceptCandidate([
        cand("p-old", 0.95, false, "phone-exact + name"),
        cand("p-other", 0.65, false, "name + dob"),
      ]);
      expect(winner).toBeNull();
    });
  });

  describe("edge cases that previously crossed 0.85", () => {
    it("score = 0.84 → no auto-accept (current behaviour preserved)", () => {
      expect(
        chooseAutoAcceptCandidate([cand("p-1", 0.84, false)])
      ).toBeNull();
    });
    it("score = 0.85 → no auto-accept (THIS is the regression the change targets)", () => {
      expect(
        chooseAutoAcceptCandidate([cand("p-1", 0.85, false)])
      ).toBeNull();
    });
    it("score = 0.99 with no email-exact → no auto-accept", () => {
      expect(
        chooseAutoAcceptCandidate([cand("p-1", 0.99, false)])
      ).toBeNull();
    });
    it("empty candidate list → null", () => {
      expect(chooseAutoAcceptCandidate([])).toBeNull();
    });
  });

  describe("future-proofing", () => {
    it("email-exact flag set but score < 1.0 → no auto-accept (defensive)", () => {
      // Today the SQL guarantees email-exact contributes 1.0 to raw_score,
      // so this combination is impossible. If a future scoring tweak
      // lowers the email weight, this guard keeps the auto-accept gate
      // conservative without code change elsewhere.
      const winner = chooseAutoAcceptCandidate([
        cand("p-1", 0.7, true, "email exact (weighted low)"),
      ]);
      expect(winner).toBeNull();
    });

    it("the auto-accept candidate is RETURNED unmodified (no field mutation)", () => {
      // The caller uses `winner.patientId` to write the map row. Make sure
      // we don't accidentally rewrite the score or method here.
      const input: LinkCandidate = {
        patientId: "p-1",
        score: 1.0,
        isEmailExact: true,
        reason: "email exact",
      };
      const winner = chooseAutoAcceptCandidate([input]);
      expect(winner).toBe(input);
    });
  });
});
