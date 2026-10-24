import { describe, expect, it } from "vitest";
import {
  approvalDueAt,
  approvalDueDay,
  canCreateModel,
  canDecideApproval,
  canSubmitForApproval,
  cloneDeletionDueOn,
  cloneDeletionOverdue,
  cloneUsable,
  postsToStopOnRevocation,
  verzugStartDay,
  type CloneFacts,
  type GateItem,
} from "./content-gate";

const caption = "Was passiert bei einer Lidstraffung? KI-generiert";
const base: GateItem = {
  status: "entwurf",
  caption,
  usesClone: false,
  aiContent: true,
  hwgCheck: { input: caption, verdict: "clean" },
  hwgWarningsAckBy: null,
  noBeforeAfterConfirmedBy: "karam@eins.ag",
};
const d = (iso: string) => new Date(iso);
const validClone: CloneFacts = {
  consentSignedAt: d("2026-10-01T10:00:00Z"),
  consentDocumentKey: "c/consent.pdf",
  trainingOptoutDocumentKey: "c/optout.pdf",
  trainingOptoutConfirmedAt: d("2026-10-02T10:00:00Z"),
  modelCreatedAt: d("2026-10-03T10:00:00Z"),
  revokedAt: null,
  deletedAt: null,
};

describe("canSubmitForApproval", () => {
  it("passes a clean, labelled, confirmed draft", () => {
    expect(canSubmitForApproval(base, null)).toEqual({ ok: true });
  });

  it("returns every blocking reason at once", () => {
    const r = canSubmitForApproval(
      { ...base, status: "live", caption: "Ohne Hinweis", hwgCheck: null, noBeforeAfterConfirmedBy: null },
      null
    );
    expect(r).toEqual({
      ok: false,
      reasons: ["status", "hwg_missing", "ki_label_missing", "no_before_after_unconfirmed"],
    });
  });

  it("blocks a caption changed after the HWG check", () => {
    const r = canSubmitForApproval({ ...base, caption: `${caption} Jetzt neu.` }, null);
    expect(r).toMatchObject({ ok: false, reasons: expect.arrayContaining(["hwg_outdated"]) });
  });

  it("blocks a violation even when acknowledged, and warnings until acknowledged by name", () => {
    expect(
      canSubmitForApproval({ ...base, hwgCheck: { input: caption, verdict: "violation" }, hwgWarningsAckBy: "x" }, null)
    ).toMatchObject({ ok: false, reasons: ["hwg_violation"] });
    const warn = { ...base, hwgCheck: { input: caption, verdict: "warn" as const } };
    expect(canSubmitForApproval(warn, null)).toMatchObject({ ok: false, reasons: ["hwg_warnings_unacknowledged"] });
    expect(canSubmitForApproval({ ...warn, hwgWarningsAckBy: "  " }, null).ok).toBe(false);
    expect(canSubmitForApproval({ ...warn, hwgWarningsAckBy: "karam@eins.ag" }, null)).toEqual({ ok: true });
  });

  it("needs the label only for AI or clone posts", () => {
    const plain = { ...base, aiContent: false, caption: "Ohne", hwgCheck: { input: "Ohne", verdict: "clean" as const } };
    expect(canSubmitForApproval(plain, null)).toEqual({ ok: true });
    expect(canSubmitForApproval({ ...plain, usesClone: true }, validClone)).toMatchObject({
      ok: false,
      reasons: ["ki_label_missing"],
    });
  });

  it("clone posts need a usable clone record", () => {
    const clonePost = { ...base, usesClone: true };
    expect(canSubmitForApproval(clonePost, validClone)).toEqual({ ok: true });
    expect(canSubmitForApproval(clonePost, null)).toMatchObject({ ok: false, reasons: ["clone_record_invalid"] });
    expect(canSubmitForApproval(clonePost, { ...validClone, revokedAt: d("2026-10-05T00:00:00Z") })).toMatchObject({
      ok: false,
      reasons: ["clone_record_invalid"],
    });
    expect(canSubmitForApproval(clonePost, { ...validClone, modelCreatedAt: null }).ok).toBe(false);
  });
});

describe("approval deadline (2 Werktage, holidays of all Länder)", () => {
  it("Monday → Wednesday, due at Thursday 00:00 Berlin", () => {
    const sent = d("2026-10-12T08:00:00Z"); // Mo 12.10.
    expect(approvalDueDay(sent)).toBe("2026-10-14");
    expect(approvalDueAt(sent).toISOString()).toBe("2026-10-14T22:00:00.000Z");
    expect(verzugStartDay(approvalDueAt(sent))).toBe("2026-10-15");
  });

  it("Thursday evening skips the weekend", () => {
    expect(approvalDueDay(d("2026-10-15T19:00:00Z"))).toBe("2026-10-19"); // Do → Fr, Mo
  });

  it("a Saturday send counts Monday and Tuesday", () => {
    expect(approvalDueDay(d("2026-10-17T09:00:00Z"))).toBe("2026-10-20");
  });

  it("skips a holiday of a single Land (Reformationstag, 31.10.2026 is a Saturday; 2027 Sunday) and nationwide ones", () => {
    // 29.10.2026 Thu → Fr 30.10., Sa/So, Mo 02.11. (Allerheiligen 01.11. is Sunday)
    expect(approvalDueDay(d("2026-10-29T10:00:00Z"))).toBe("2026-11-02");
    // Fronleichnam 2027-05-27 (only some Länder): Wed 26.05. → Fri 28.05., Mon 31.05.
    expect(approvalDueDay(d("2027-05-26T10:00:00Z"))).toBe("2027-05-31");
    // Tag der Deutschen Einheit 2026-10-03 is a Saturday; 2025-10-03 Friday:
    expect(approvalDueDay(d("2025-10-01T10:00:00Z"))).toBe("2025-10-06");
  });

  it("a send just before midnight Berlin still belongs to that day", () => {
    expect(approvalDueDay(d("2026-10-12T21:59:00Z"))).toBe("2026-10-14"); // Mo 23:59 Berlin
    expect(approvalDueDay(d("2026-10-12T22:01:00Z"))).toBe("2026-10-15"); // Di 00:01 Berlin
  });
});

describe("who decides", () => {
  it("clone posts: Inhaber only; others: Inhaber and Marketing; Empfang never", () => {
    expect(canDecideApproval("inhaber", true)).toBe(true);
    expect(canDecideApproval("marketing", true)).toBe(false);
    expect(canDecideApproval("marketing", false)).toBe(true);
    expect(canDecideApproval("frontdesk", false)).toBe(false);
    expect(canDecideApproval(null, false)).toBe(false);
  });
});

describe("clone record", () => {
  it("no model without consent and the tool's training opt-out", () => {
    expect(canCreateModel(validClone)).toBe(true);
    expect(canCreateModel({ ...validClone, trainingOptoutDocumentKey: null })).toBe(false);
    expect(canCreateModel({ ...validClone, trainingOptoutConfirmedAt: null })).toBe(false);
    expect(canCreateModel({ ...validClone, consentSignedAt: null })).toBe(false);
    expect(cloneUsable({ ...validClone, deletedAt: d("2026-12-01T00:00:00Z") })).toBe(false);
  });

  it("deletion due 30 days after contract end", () => {
    expect(cloneDeletionDueOn("2026-12-31")).toBe("2027-01-30");
    expect(cloneDeletionDueOn(null)).toBeNull();
    expect(cloneDeletionOverdue("2026-12-31", null, "2027-01-29")).toBe(false);
    expect(cloneDeletionOverdue("2026-12-31", null, "2027-01-30")).toBe(true);
    expect(cloneDeletionOverdue("2026-12-31", d("2027-01-10T00:00:00Z"), "2027-02-10")).toBe(false);
  });

  it("a revocation makes the deletion due at once, also without a contract end", () => {
    expect(cloneDeletionDueOn(null, "2026-11-03")).toBe("2026-11-03");
    expect(cloneDeletionDueOn("2026-12-31", "2026-11-03")).toBe("2026-11-03");
    expect(cloneDeletionDueOn("2026-10-01", "2026-11-03")).toBe("2026-10-31");
    expect(cloneDeletionOverdue(null, null, "2026-11-03", "2026-11-03")).toBe(true);
    expect(cloneDeletionOverdue(null, null, "2026-11-02", null)).toBe(false);
  });

  it("revocation flags exactly the clone posts not stopped yet", () => {
    const items = [
      { id: "a", usesClone: true, status: "live" as const },
      { id: "b", usesClone: true, status: "gestoppt" as const },
      { id: "c", usesClone: false, status: "live" as const },
      { id: "d", usesClone: true, status: "entwurf" as const },
    ];
    expect(postsToStopOnRevocation(items).map((i) => i.id)).toEqual(["a", "d"]);
  });
});
