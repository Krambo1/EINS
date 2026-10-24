import { describe, expect, it } from "vitest";
import {
  SLUG_ALPHABET,
  SLUG_LENGTH,
  SLUG_PATTERN,
  deviceFromUserAgent,
  extensionOf,
  formatDuration,
  isVideoExtension,
  normalizeObsidianRef,
  obsidianHref,
  parseVideoEvent,
  publicVideoUrl,
} from "./outreach-video";
import { viewerHash } from "./outreach-video-hash";

const SESSION = "k3J9x_aB-2QwErTy";

describe("parseVideoEvent", () => {
  it("accepts the four beacon kinds", () => {
    expect(parseVideoEvent(JSON.stringify({ k: "open", s: SESSION }))).toEqual({ k: "open", s: SESSION });
    expect(parseVideoEvent(JSON.stringify({ k: "play", s: SESSION, i: true }))?.i).toBe(true);
    expect(parseVideoEvent(JSON.stringify({ k: "progress", s: SESSION, p: 50 }))?.p).toBe(50);
    expect(parseVideoEvent(JSON.stringify({ k: "cta", s: SESSION }))?.k).toBe("cta");
  });

  it("only takes the fixed milestones, so a client cannot write 1000 distinct rows", () => {
    expect(parseVideoEvent(JSON.stringify({ k: "progress", s: SESSION, p: 51 }))).toBeNull();
    expect(parseVideoEvent(JSON.stringify({ k: "progress", s: SESSION }))).toBeNull();
    expect(parseVideoEvent(JSON.stringify({ k: "open", s: SESSION, p: 50 }))).toBeNull();
  });

  it("rejects junk, unknown kinds, odd session ids and oversized bodies", () => {
    expect(parseVideoEvent("not json")).toBeNull();
    expect(parseVideoEvent(JSON.stringify({ k: "delete", s: SESSION }))).toBeNull();
    expect(parseVideoEvent(JSON.stringify({ k: "open", s: "short" }))).toBeNull();
    expect(parseVideoEvent(JSON.stringify({ k: "open", s: "a b c d e f g h" }))).toBeNull();
    expect(parseVideoEvent(JSON.stringify({ k: "open", s: SESSION, pad: "x".repeat(600) }))).toBeNull();
  });
});

describe("viewerHash", () => {
  const key = new Uint8Array(32).fill(7);
  const day1 = new Date("2026-09-29T08:00:00Z");
  const day1Later = new Date("2026-09-29T21:00:00Z");
  const day2 = new Date("2026-09-30T08:00:00Z");

  it("is stable for one device within a UTC day", () => {
    expect(viewerHash(key, "1.2.3.4", "UA", day1)).toBe(viewerHash(key, "1.2.3.4", "UA", day1Later));
  });

  it("changes across days, devices and keys", () => {
    const base = viewerHash(key, "1.2.3.4", "UA", day1);
    expect(viewerHash(key, "1.2.3.4", "UA", day2)).not.toBe(base);
    expect(viewerHash(key, "1.2.3.5", "UA", day1)).not.toBe(base);
    expect(viewerHash(key, "1.2.3.4", "UA2", day1)).not.toBe(base);
    expect(viewerHash(new Uint8Array(32).fill(8), "1.2.3.4", "UA", day1)).not.toBe(base);
  });

  it("never contains the IP", () => {
    expect(viewerHash(key, "203.0.113.9", "UA", day1)).not.toContain("203");
  });
});

describe("deviceFromUserAgent", () => {
  it("classifies the common agents", () => {
    expect(
      deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")
    ).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 13; SM-X700) Safari")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128")).toBe("desktop");
    expect(deviceFromUserAgent(null)).toBe("desktop");
  });
});

describe("normalizeObsidianRef", () => {
  const id = "36fe7fc8873481f983dbd08614a82787";
  const uri = "obsidian://open?vault=Karam&file=10%20EINS%2FKunden%2FLeads%2FPraxis-Eintr%C3%A4ge%2FDr%20Jafari";
  it("takes lead-ids as bare or dashed hex", () => {
    expect(normalizeObsidianRef(id)).toBe(id);
    expect(normalizeObsidianRef(id.toUpperCase())).toBe(id);
    expect(normalizeObsidianRef("36fe7fc8-8734-81f9-83db-d08614a82787")).toBe(id);
    expect(normalizeObsidianRef(`  ${id}
`)).toBe(id);
  });
  it("keeps an obsidian:// URI of the Karam vault as is", () => {
    expect(normalizeObsidianRef(uri)).toBe(uri);
  });
  it("rejects URIs of other vaults or actions", () => {
    expect(normalizeObsidianRef("obsidian://open?vault=Other&file=x")).toBeNull();
    expect(normalizeObsidianRef("obsidian://open?vault=Karam")).toBeNull();
    expect(normalizeObsidianRef("obsidian://new?vault=Karam&file=x")).toBeNull();
  });
  it("turns wikilinks and vault paths into an open URI without .md", () => {
    const want = "obsidian://open?vault=Karam&file=10%20EINS%2FOutreach%2FTeardowns%2FDr%20Jafari";
    expect(normalizeObsidianRef("[[10 EINS/Outreach/Teardowns/Dr Jafari]]")).toBe(want);
    expect(normalizeObsidianRef("[[10 EINS/Outreach/Teardowns/Dr Jafari|Teardown]]")).toBe(want);
    expect(normalizeObsidianRef("[[10 EINS/Outreach/Teardowns/Dr Jafari#Befund]]")).toBe(want);
    expect(normalizeObsidianRef("10 EINS/Outreach/Teardowns/Dr Jafari.md")).toBe(want);
    expect(normalizeObsidianRef("10 EINS\\Outreach\\Teardowns\\Dr Jafari.md")).toBe(want);
  });
  it("returns null for everything else", () => {
    expect(normalizeObsidianRef("")).toBeNull();
    expect(normalizeObsidianRef(null)).toBeNull();
    expect(normalizeObsidianRef("https://www.notion.so/some-page")).toBeNull();
    expect(normalizeObsidianRef(`https://www.notion.so/Praxis-${id}`)).toBeNull();
    expect(normalizeObsidianRef("Dr Jafari")).toBeNull();
    expect(normalizeObsidianRef("../secret.md")).toBeNull();
    expect(normalizeObsidianRef("C:/Users/x/note.md")).toBeNull();
    expect(normalizeObsidianRef("[[ ]]")).toBeNull();
  });
});

describe("obsidianHref", () => {
  const id = "36fe7fc8873481f983dbd08614a82787";
  it("links a URI as is and a lead-id as a property search", () => {
    const uri = "obsidian://open?vault=Karam&file=a%2Fb";
    expect(obsidianHref(uri)).toBe(uri);
    expect(obsidianHref(id)).toBe(
      `obsidian://search?vault=Karam&query=${encodeURIComponent(`["lead-id":${id}]`)}`
    );
  });
  it("returns null for empty or unknown values", () => {
    expect(obsidianHref(null)).toBeNull();
    expect(obsidianHref("javascript:alert(1)")).toBeNull();
  });
});

describe("slugs and small helpers", () => {
  it("slug alphabet has no look-alike characters", () => {
    for (const c of "01ilo") expect(SLUG_ALPHABET).not.toContain(c);
    expect(SLUG_ALPHABET).toHaveLength(31);
    expect(SLUG_PATTERN.test("a".repeat(SLUG_LENGTH))).toBe(true);
    expect(SLUG_PATTERN.test("a".repeat(SLUG_LENGTH - 1))).toBe(false);
    expect(SLUG_PATTERN.test("abcdefghi0")).toBe(false);
    expect(SLUG_PATTERN.test("../../etc1")).toBe(false);
  });

  it("builds the public URL without a double slash", () => {
    expect(publicVideoUrl("https://eins.ag/", "abcdefghjk")).toBe("https://eins.ag/v/abcdefghjk");
  });

  it("extensions and durations", () => {
    expect(extensionOf("Teardown Final.MP4")).toBe("mp4");
    expect(isVideoExtension("mp4")).toBe(true);
    expect(isVideoExtension("mkv")).toBe(false);
    expect(formatDuration(247)).toBe("4:07");
    expect(formatDuration(59)).toBe("0:59");
  });
});

describe("isLikelyScanner (G-18)", () => {
  it("flags scanners, bots and empty agents", async () => {
    const { isLikelyScanner } = await import("./outreach-video");
    expect(isLikelyScanner(null)).toBe(true);
    expect(isLikelyScanner("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0")).toBe(true);
    expect(isLikelyScanner("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isLikelyScanner("python-requests/2.31")).toBe(true);
    expect(isLikelyScanner("WhatsApp/2.23.20.0")).toBe(true);
  });
  it("lets normal browsers through", async () => {
    const { isLikelyScanner } = await import("./outreach-video");
    expect(
      isLikelyScanner(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe(false);
    expect(
      isLikelyScanner(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      )
    ).toBe(false);
  });
});
