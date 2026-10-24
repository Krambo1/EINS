import { describe, expect, it } from "vitest";
import { quizAnswerLines } from "./quiz-answers";

describe("quizAnswerLines", () => {
  it("maps known option ids to German text", () => {
    expect(
      quizAnswerLines({
        timeframe: "asap",
        budget: "unsicher",
        distance: "bis-1-stunde",
        city: " Köln ",
        branch: "qualified",
        fbp: "fb.1.123",
      })
    ).toEqual([
      { label: "Zeitrahmen", value: "So bald wie möglich" },
      { label: "Budget", value: "Investitionsrahmen unsicher" },
      { label: "Anfahrt", value: "Bis zu 1 Stunde entfernt" },
      { label: "Ort", value: "Köln" },
    ]);
  });

  it("shows unknown values as sent and skips empty ones", () => {
    expect(quizAnswerLines({ timeframe: "q3", city: "", experience: 4 })).toEqual([
      { label: "Zeitrahmen", value: "q3" },
    ]);
  });

  it("adds the info branch only when no other answer says so", () => {
    expect(quizAnswerLines({ branch: "info-only", timeframe: "info-only" })).toEqual([
      { label: "Zeitrahmen", value: "Möchte sich erst informieren" },
    ]);
    expect(quizAnswerLines({ branch: "info-only", timeframe: "later" })).toContainEqual({
      label: "Anliegen",
      value: "Möchte sich erst informieren",
    });
  });

  it("handles a missing quiz", () => {
    expect(quizAnswerLines(null)).toEqual([]);
  });
});
