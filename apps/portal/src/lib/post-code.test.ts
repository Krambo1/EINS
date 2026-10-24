import { describe, expect, it } from "vitest";
import { buildContentLink, buildContentLinks, zielseiteOrigin } from "./content-links";
import {
  POST_CODE_DIGITS,
  POST_CODE_LETTERS,
  generatePostCode,
  isPostCode,
  postCodeFromUtm,
} from "./post-code";
import { classifyAttribution } from "./sources";

describe("post code", () => {
  it("generates 5-character codes from the vowel-free alphabet, always valid", () => {
    for (let i = 0; i < 2000; i++) {
      const c = generatePostCode();
      expect(c).toHaveLength(5);
      expect(isPostCode(c)).toBe(true);
      expect(c).not.toMatch(/[aeiouyl01]/);
    }
  });

  it("cannot form words: no vowels in the alphabet", () => {
    expect(POST_CODE_LETTERS).not.toMatch(/[aeiouy]/);
    expect(POST_CODE_DIGITS).not.toMatch(/[01]/);
  });

  it("needs a letter and a digit", () => {
    expect(isPostCode("b7k2x")).toBe(true);
    expect(isPostCode("bcdfg")).toBe(false);
    expect(isPostCode("23456")).toBe(false);
  });

  it("rejects everything else", () => {
    for (const v of ["botox", "B7K2X", "b7k2", "b7k2xx", "nase-1", "reel-2026-10-04", "a7k2x", "b0k2x", "", null, 12345]) {
      expect(isPostCode(v)).toBe(false);
    }
  });

  it("reads a post code from utm_content only when it matches", () => {
    expect(postCodeFromUtm({ utm_content: "b7k2x" })).toBe("b7k2x");
    expect(postCodeFromUtm({ utm_content: " B7K2X " })).toBe("b7k2x");
    expect(postCodeFromUtm({ utm_content: "anzeige_botox_v2" })).toBeNull();
    expect(postCodeFromUtm({})).toBeNull();
    expect(postCodeFromUtm(null)).toBeNull();
  });

  it("retries until a code has a letter and a digit", () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0, 19, 0, 0, 0, 0];
    expect(generatePostCode(() => seq[i++ % seq.length]!)).toBe("2bbbb");
  });
});

describe("content links", () => {
  it("accepts only https origins", () => {
    expect(zielseiteOrigin("https://praxis-mueller.de/foo")).toBe("https://praxis-mueller.de");
    expect(zielseiteOrigin("http://praxis-mueller.de")).toBeNull();
    expect(zielseiteOrigin("praxis-mueller.de")).toBeNull();
    expect(zielseiteOrigin(null)).toBeNull();
  });

  it("builds tagged links to the start page that classify as the right channel and post", () => {
    const links = Object.fromEntries(
      buildContentLinks("https://praxis-mueller.de", "b7k2x").map((l) => [l.medium, l.url])
    );
    expect(links.dm).toBe("https://praxis-mueller.de/?utm_source=instagram&utm_medium=dm&utm_content=b7k2x");
    expect(links.profil_link).toBe("https://praxis-mueller.de/?utm_source=instagram&utm_medium=profil_link");

    const utmOf = (u: string) => Object.fromEntries(new URL(u).searchParams);
    expect(classifyAttribution({ source: "formular", utm: utmOf(links.dm!) })).toMatchObject({ channel: "dm_link", post: "b7k2x" });
    expect(classifyAttribution({ source: "formular", utm: utmOf(links.story_link!) })).toMatchObject({
      channel: "instagram_organisch",
      post: "b7k2x",
    });
    expect(classifyAttribution({ source: "formular", utm: utmOf(links.profil_link!) }).channel).toBe("profil_link");
  });

  it("never names a treatment or campaign", () => {
    for (const { url } of buildContentLinks("https://praxis-mueller.de", "b7k2x")) {
      expect(url).not.toMatch(/utm_campaign|utm_term/);
    }
    expect(() => buildContentLink({ origin: "https://x.de", code: "botox", medium: "dm" })).toThrow();
  });
});
