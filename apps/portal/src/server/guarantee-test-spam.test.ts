import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TEST_SPAM_VIA, restorePlan, shouldMarkSpam } from "./guarantee-test-spam";

describe("D6: test rejection also sets spam", () => {
  it("only for test_eintrag and only when not already spam", () => {
    expect(shouldMarkSpam("test_eintrag", "neu")).toBe(true);
    expect(shouldMarkSpam("test_eintrag", "kontaktiert")).toBe(true);
    expect(shouldMarkSpam("test_eintrag", "spam")).toBe(false);
    expect(shouldMarkSpam("spam_automatisiert", "neu")).toBe(false);
    expect(shouldMarkSpam("keine_kontaktdaten", "neu")).toBe(false);
  });
});

describe("D6: undo restores the previous status", () => {
  const ours = { from: "nicht_erreicht", to: "spam", via: TEST_SPAM_VIA };

  it("restores when the test spam is still the latest status change", () => {
    expect(restorePlan({ reason: "test_eintrag", currentStatus: "spam", latestChangeMeta: ours })).toEqual({
      restore: "nicht_erreicht",
    });
  });

  it("leaves other rejection reasons alone", () => {
    expect(restorePlan({ reason: "bewerbung", currentStatus: "spam", latestChangeMeta: ours })).toEqual({
      keep: "kein_test",
    });
  });

  it("leaves the status when it is no longer spam", () => {
    expect(restorePlan({ reason: "test_eintrag", currentStatus: "neu", latestChangeMeta: ours })).toEqual({
      keep: "kein_spam",
    });
  });

  it("leaves the status when someone changed it in between (spam -> neu -> spam)", () => {
    const praxis = { from: "neu", to: "spam" };
    expect(restorePlan({ reason: "test_eintrag", currentStatus: "spam", latestChangeMeta: praxis })).toEqual({
      keep: "status_geaendert",
    });
  });

  it("leaves the status for rejections made before D6 (no own status change)", () => {
    expect(restorePlan({ reason: "test_eintrag", currentStatus: "spam", latestChangeMeta: undefined })).toEqual({
      keep: "status_geaendert",
    });
    expect(restorePlan({ reason: "test_eintrag", currentStatus: "spam", latestChangeMeta: "x" })).toEqual({
      keep: "status_geaendert",
    });
  });

  it("does not restore an unknown or spam previous status", () => {
    for (const from of ["quatsch", "spam", null]) {
      expect(
        restorePlan({
          reason: "test_eintrag",
          currentStatus: "spam",
          latestChangeMeta: { from, to: "spam", via: TEST_SPAM_VIA },
        })
      ).toEqual({ keep: "vorheriger_status_unbekannt" });
    }
  });
});

describe("D6 wiring in the garantie actions", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../app/admin/garantie/actions.ts", import.meta.url)),
    "utf8"
  );
  const body = (name: string) => {
    const start = src.indexOf(`async function ${name}(`);
    const next = src.indexOf("\nasync function ", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };

  it("reject sets spam inside the transaction, audits it and refreshes the Praxis side", () => {
    const run = body("rejectInquiryActionRun");
    const tx = run.slice(run.indexOf("db.transaction"), run.indexOf("refresh(d.clinicId)"));
    expect(tx).toMatch(/markTestInquiryAsSpam\(tx,/);
    expect(tx).toMatch(/alsoSpam: true, statusBefore: spam\.statusBefore/);
    expect(run).toMatch(/refreshPraxisRequest\(d\.clinicId, d\.requestId\)/);
  });

  it("undo restores inside the transaction and refreshes the Praxis side", () => {
    const run = body("undoRejectionActionRun");
    expect(run).toMatch(/restoreTestInquiryStatus\(tx,/);
    expect(run).toMatch(/refreshPraxisRequest\(d\.clinicId, restored\)/);
  });
});
