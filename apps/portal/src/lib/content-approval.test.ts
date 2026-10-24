import { describe, expect, it } from "vitest";
import {
  approvalDueDayOf,
  approvalVerzugReason,
  firstDecisionOutcome,
  formatApprovalDue,
  groupApprovalRecipients,
  linkExpired,
  normalizeDecision,
  statusAfterDecision,
  verzugEndDay,
  type RecordedDecision,
} from "./content-approval";
import { approvalDueAt, approvalRecipientRoles } from "./content-gate";

const decided = (d: RecordedDecision["decision"], via: RecordedDecision["decidedVia"] = "link"): RecordedDecision => ({
  decision: d,
  changeText: d === "aenderung" ? "Bitte kürzer" : null,
  decidedAt: new Date("2026-10-12T09:00:00Z"),
  decidedVia: via,
});

describe("normalizeDecision", () => {
  it("accepts an approval and drops any text", () => {
    expect(normalizeDecision("freigegeben", "egal")).toEqual({ ok: true, decision: "freigegeben", changeText: null });
  });
  it("needs a change description for aenderung", () => {
    expect(normalizeDecision("aenderung", "   ").ok).toBe(false);
    expect(normalizeDecision("aenderung", null).ok).toBe(false);
    expect(normalizeDecision("aenderung", "  Ton freundlicher ")).toEqual({
      ok: true,
      decision: "aenderung",
      changeText: "Ton freundlicher",
    });
  });
  it("rejects unknown decisions and overlong text", () => {
    expect(normalizeDecision("live", null).ok).toBe(false);
    expect(normalizeDecision("aenderung", "x".repeat(2001)).ok).toBe(false);
  });
});

describe("first decision wins", () => {
  it("the claimed row is the recorded decision", () => {
    expect(firstDecisionOutcome(decided("freigegeben"), null)).toEqual({ recorded: true, decision: decided("freigegeben") });
  });
  it("a second attempt gets the decision already on record, not an error", () => {
    const first = decided("aenderung", "portal");
    expect(firstDecisionOutcome(null, first)).toEqual({ recorded: false, decision: first });
  });
});

describe("statusAfterDecision", () => {
  it("moves a waiting post to the decision", () => {
    expect(statusAfterDecision("zur_freigabe", "freigegeben")).toBe("freigegeben");
    expect(statusAfterDecision("zur_freigabe", "aenderung")).toBe("aenderung");
  });
  it("leaves a post EINS stopped or pulled back as it is", () => {
    expect(statusAfterDecision("gestoppt", "freigegeben")).toBeNull();
    expect(statusAfterDecision("entwurf", "freigegeben")).toBeNull();
    expect(statusAfterDecision("live", "aenderung")).toBeNull();
  });
});

describe("link expiry", () => {
  it("expires at token_expires_at", () => {
    const at = new Date("2026-11-01T10:00:00Z");
    expect(linkExpired(at, new Date("2026-11-01T09:59:59Z"))).toBe(false);
    expect(linkExpired(at, at)).toBe(true);
  });
});

describe("due day and Verzug", () => {
  it("shows the last day, not the following midnight", () => {
    // Thursday 08.10.2026 → Friday, Monday: due Monday 12.10.
    const dueAt = approvalDueAt(new Date("2026-10-08T10:00:00Z"));
    expect(approvalDueDayOf(dueAt)).toBe("2026-10-12");
    expect(formatApprovalDue(dueAt)).toBe("Montag, 12.10.2026");
  });
  it("names the batch day in the Verzug reason", () => {
    expect(approvalVerzugReason(new Date("2026-10-08T22:30:00Z"))).toBe(
      "Freigabe der Beiträge vom 09.10.2026 nicht innerhalb von 2 Werktagen"
    );
  });
  it("ends the Verzug on the day of the last decision, never before it began", () => {
    expect(verzugEndDay("2026-10-13", new Date("2026-10-15T08:00:00Z"))).toBe("2026-10-15");
    expect(verzugEndDay("2026-10-13", new Date("2026-10-11T08:00:00Z"))).toBe("2026-10-13");
    expect(verzugEndDay("2026-10-13", null, new Date("2026-10-14T08:00:00Z"))).toBe("2026-10-14");
  });
});

describe("groupApprovalRecipients (Inhaber only for clone posts)", () => {
  const posts = [
    { id: "a", inhaberOnly: false },
    { id: "k", inhaberOnly: true },
  ];
  const users = [
    { email: "Inhaberin@Praxis.de", fullName: "Dr. A", role: "inhaber" },
    { email: "marketing@praxis.de", fullName: null, role: "marketing" },
    { email: "empfang@praxis.de", fullName: null, role: "frontdesk" },
    { email: "inhaberin@praxis.de", fullName: "Doppelt", role: "inhaber" },
  ];
  it("sends clone posts to Inhaber users only and nothing to the front desk", () => {
    const g = groupApprovalRecipients(posts, users, approvalRecipientRoles);
    expect(g.map((x) => [x.recipient.email, x.posts.map((p) => p.id)])).toEqual([
      ["inhaberin@praxis.de", ["a", "k"]],
      ["marketing@praxis.de", ["a"]],
    ]);
  });
  it("drops a recipient with nothing to decide", () => {
    const g = groupApprovalRecipients([{ id: "k", inhaberOnly: true }], users.slice(1, 3), approvalRecipientRoles);
    expect(g).toEqual([]);
  });
});
