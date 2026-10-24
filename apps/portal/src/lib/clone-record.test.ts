import { describe, expect, it } from "vitest";
import type { CloneFacts } from "./content-gate";
import {
  MODEL_GATE_MESSAGE,
  cloneSteps,
  isCloneChecklistItem,
  isCloneDocumentKey,
  modelBlockReason,
  modelDateProblem,
  postCountLabel,
  revocationMail,
  revocationStopReason,
} from "./clone-record";

const CLINIC = "4b1f0b5e-0000-4000-8000-000000000000";
const OTHER = "5c2f0b5e-0000-4000-8000-000000000000";
const FILE = "0d9e8c7b-1111-4222-8333-444455556666";

const empty: CloneFacts = {
  consentSignedAt: null,
  consentDocumentKey: null,
  trainingOptoutDocumentKey: null,
  trainingOptoutConfirmedAt: null,
  modelCreatedAt: null,
  revokedAt: null,
  deletedAt: null,
};

const ready: CloneFacts = {
  ...empty,
  consentSignedAt: new Date("2026-10-01T10:00:00Z"),
  consentDocumentKey: `klon/${CLINIC}/${FILE}.pdf`,
  trainingOptoutDocumentKey: `klon/${CLINIC}/${FILE}.png`,
  trainingOptoutConfirmedAt: new Date("2026-10-02T10:00:00Z"),
};

describe("clone documents", () => {
  it("accepts only klon/<this clinic>/<uuid>.<allowed ext>", () => {
    expect(isCloneDocumentKey(CLINIC, `klon/${CLINIC}/${FILE}.pdf`)).toBe(true);
    expect(isCloneDocumentKey(CLINIC, `klon/${OTHER}/${FILE}.pdf`)).toBe(false);
    expect(isCloneDocumentKey(CLINIC, `${CLINIC}/klon/${FILE}.pdf`)).toBe(false);
    expect(isCloneDocumentKey(CLINIC, `klon/${CLINIC}/${FILE}.svg`)).toBe(false);
    expect(isCloneDocumentKey(CLINIC, `klon/${CLINIC}/../${FILE}.pdf`)).toBe(false);
  });

  it("marks A5 and F5 as clone checklist items", () => {
    expect(isCloneChecklistItem("A5")).toBe(true);
    expect(isCloneChecklistItem("F5")).toBe(true);
    expect(isCloneChecklistItem("F6")).toBe(false);
  });
});

describe("modelBlockReason", () => {
  it("blocks without consent or opt-out with the Betriebspflicht message", () => {
    expect(modelBlockReason(empty)).toBe(MODEL_GATE_MESSAGE);
    expect(modelBlockReason({ ...ready, trainingOptoutDocumentKey: null })).toBe(MODEL_GATE_MESSAGE);
    expect(modelBlockReason({ ...ready, trainingOptoutConfirmedAt: null })).toBe(MODEL_GATE_MESSAGE);
  });

  it("allows a ready record and names revoked, deleted and existing models", () => {
    expect(modelBlockReason(ready)).toBeNull();
    expect(modelBlockReason({ ...ready, revokedAt: new Date() })).toMatch(/widerrufen/);
    expect(modelBlockReason({ ...ready, deletedAt: new Date() })).toMatch(/gelöscht/);
    expect(modelBlockReason({ ...ready, modelCreatedAt: new Date() })).toMatch(/schon/);
  });
});

describe("modelDateProblem", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("rejects a date before the opt-out or in the future", () => {
    expect(modelDateProblem(ready, new Date("2026-10-01T12:00:00Z"), now)).toMatch(/Trainings-Widerspruch/);
    expect(modelDateProblem(ready, new Date("2026-10-10T12:00:00Z"), now)).toMatch(/Zukunft/);
    expect(modelDateProblem(ready, new Date("2026-10-05T12:00:00Z"), now)).toBeNull();
  });
});

describe("cloneSteps", () => {
  it("lists the six steps in order and marks an overdue deletion", () => {
    const steps = cloneSteps(
      { ...ready, modelCreatedAt: new Date("2026-10-03T10:00:00Z"), contractEndOn: "2026-08-01" },
      "2026-08-31"
    );
    expect(steps.map((s) => s.key)).toEqual([
      "einwilligung",
      "widerspruch",
      "modell",
      "vertragsende",
      "loeschung_faellig",
      "geloescht",
    ]);
    expect(steps.map((s) => s.state)).toEqual(["erledigt", "erledigt", "erledigt", "erledigt", "ueberfaellig", "offen"]);
    expect(steps[4]!.date).toBe("31.08.2026");
  });

  it("open deletion before the due day, done once deleted", () => {
    const before = cloneSteps({ ...ready, contractEndOn: "2026-08-01" }, "2026-08-30");
    expect(before[4]!.state).toBe("offen");
    const deleted = cloneSteps({ ...ready, contractEndOn: "2026-08-01", deletedAt: new Date("2026-09-15T10:00:00Z") }, "2026-10-01");
    expect(deleted[4]!.state).toBe("erledigt");
    expect(deleted[5]!.state).toBe("erledigt");
  });

  it("consent without document is not done", () => {
    const steps = cloneSteps({ ...empty, consentSignedAt: new Date(), contractEndOn: null }, "2026-10-09");
    expect(steps[0]!.state).toBe("offen");
    expect(steps[4]!.date).toBeNull();
  });
});

describe("revocation texts", () => {
  it("builds the stop reason and the mail subject", () => {
    expect(revocationStopReason(new Date("2026-10-09T08:00:00Z"))).toBe("Widerruf KI-Klon am 09.10.2026");
    expect(postCountLabel(1)).toBe("1 Beitrag");
    const m = revocationMail({
      clinicName: "Praxis Beispiel",
      personName: "Dr. Anna Beispiel",
      tool: "HeyGen",
      revokedAt: new Date("2026-10-09T08:00:00Z"),
      note: "Per E-Mail",
      postCount: 3,
      adminLink: "https://admin.example.test/admin/clinics/x?tab=klon",
    });
    expect(m.subject).toBe("Widerruf KI-Klon: Praxis Beispiel, 3 Beiträge zu stoppen");
    expect(m.text).toContain("3 Beiträge mit dem KI-Klon sind als „zu stoppen“ markiert");
    expect(`${m.subject}${m.text}`).not.toContain("—");
  });
});
