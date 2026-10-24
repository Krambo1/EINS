import { describe, expect, it } from "vitest";
import { AI_SCORE_EXPLANATION, aiScoreBand, aiScoreText, aiScoreTone } from "./ai-score";

describe("aiScoreText", () => {
  it("uses the scorer's bands (70 / 40)", () => {
    expect(aiScoreBand(100)).toBe("gut");
    expect(aiScoreBand(70)).toBe("gut");
    expect(aiScoreBand(69)).toBe("mittel");
    expect(aiScoreBand(40)).toBe("mittel");
    expect(aiScoreBand(39)).toBe("gering");
    expect(aiScoreBand(0)).toBe("gering");
  });

  it("shows the score on its scale, short", () => {
    expect(aiScoreText(74)).toBe("74/100");
    expect(aiScoreText(52)).toBe("52/100");
    expect(aiScoreText(12)).toBe("12/100");
    expect(aiScoreTone(74)).toBe("accent");
    expect(aiScoreTone(12)).toBe("neutral");
  });

  it("says the score never decides whether an Anfrage counts", () => {
    expect(AI_SCORE_EXPLANATION).toContain("entscheidet nie, ob eine Anfrage zählt");
    expect(AI_SCORE_EXPLANATION).not.toContain("—");
  });
});
