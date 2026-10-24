import { describe, expect, it } from "vitest";
import { CONTENT_STATUSES } from "./content-status";
import {
  adminOfferedMoves,
  checkAdminMove,
  checkPermalink,
  groupByOverviewStatus,
  isEditableStatus,
  parsePublishedDay,
  summarizePublications,
  tallyInquiries,
} from "./content-items";

describe("admin status moves", () => {
  it("never offers approval, the gate, live or stop as a plain button", () => {
    for (const from of CONTENT_STATUSES) {
      const offered = adminOfferedMoves(from);
      for (const s of ["freigegeben", "aenderung", "zur_freigabe", "live", "gestoppt"] as const) {
        expect(offered).not.toContain(s);
      }
    }
    expect(adminOfferedMoves("aenderung")).toEqual(["entwurf"]);
    expect(adminOfferedMoves("freigegeben")).toEqual(["geplant"]);
  });

  it("rejects what only the Praxis or the gate may do", () => {
    expect(checkAdminMove("zur_freigabe", "freigegeben")).toMatch(/nur die Praxis/);
    expect(checkAdminMove("zur_freigabe", "aenderung")).toMatch(/nur die Praxis/);
    expect(checkAdminMove("entwurf", "zur_freigabe")).toMatch(/nur über das Freigabe-Paket/);
    expect(checkAdminMove("freigegeben", "live")).toMatch(/Permalink/);
    expect(checkAdminMove("entwurf", "geplant")).toMatch(/nicht möglich/);
    expect(checkAdminMove("gestoppt", "entwurf")).toMatch(/nicht möglich/);
  });

  it("stopping needs a reason", () => {
    expect(checkAdminMove("live", "gestoppt")).toMatch(/Grund/);
    expect(checkAdminMove("live", "gestoppt", "   ")).toMatch(/Grund/);
    expect(checkAdminMove("live", "gestoppt", "Praxis wünscht es")).toBeNull();
    expect(checkAdminMove("aenderung", "entwurf")).toBeNull();
  });

  it("edits only in entwurf or aenderung", () => {
    expect(CONTENT_STATUSES.filter(isEditableStatus)).toEqual(["entwurf", "aenderung"]);
  });
});

describe("checkPermalink", () => {
  it("accepts single posts and strips tracking", () => {
    expect(checkPermalink("instagram", "https://www.instagram.com/reel/C9abc_12-x/?igsh=xyz")).toEqual({
      ok: true,
      url: "https://www.instagram.com/reel/C9abc_12-x/",
    });
    expect(checkPermalink("instagram", " https://instagram.com/p/AbC123 ").ok).toBe(true);
    expect(checkPermalink("tiktok", "https://www.tiktok.com/@praxis.x/video/7312345678901234567?lang=de")).toEqual({
      ok: true,
      url: "https://www.tiktok.com/@praxis.x/video/7312345678901234567",
    });
    expect(checkPermalink("tiktok", "https://vm.tiktok.com/ZGJabc123/").ok).toBe(true);
    expect(checkPermalink("facebook", "https://www.facebook.com/praxisx/posts/pfbid02abc").ok).toBe(true);
    expect(checkPermalink("facebook", "https://www.facebook.com/permalink.php?story_fbid=1&id=2")).toEqual({
      ok: true,
      url: "https://www.facebook.com/permalink.php?story_fbid=1&id=2",
    });
    expect(checkPermalink("facebook", "https://fb.watch/abc123/").ok).toBe(true);
  });

  it("rejects other hosts, http, profiles and garbage", () => {
    expect(checkPermalink("instagram", "http://www.instagram.com/p/AbC123/").ok).toBe(false);
    expect(checkPermalink("instagram", "https://www.facebook.com/praxisx/posts/1").ok).toBe(false);
    expect(checkPermalink("instagram", "https://instagram.com.evil.de/p/AbC123/").ok).toBe(false);
    expect(checkPermalink("instagram", "https://www.instagram.com/praxis.x/").ok).toBe(false);
    expect(checkPermalink("tiktok", "https://www.tiktok.com/@praxis.x").ok).toBe(false);
    expect(checkPermalink("facebook", "https://www.facebook.com/praxisx").ok).toBe(false);
    expect(checkPermalink("facebook", "https://www.facebook.com/permalink.php").ok).toBe(false);
    expect(checkPermalink("facebook", "kein link").ok).toBe(false);
    expect(checkPermalink("tiktok", "https://user:pw@www.tiktok.com/@a/video/1").ok).toBe(false);
  });
});

describe("parsePublishedDay", () => {
  const now = new Date("2026-10-08T09:00:00Z");
  it("parses a date input at midday UTC", () => {
    expect(parsePublishedDay("2026-10-07", now)?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(parsePublishedDay("2026-10-08", now)).not.toBeNull();
  });
  it("rejects invalid, old and future days", () => {
    expect(parsePublishedDay("2026-02-30", now)).toBeNull();
    expect(parsePublishedDay("07.10.2026", now)).toBeNull();
    expect(parsePublishedDay("2019-12-31", now)).toBeNull();
    expect(parsePublishedDay("2026-10-12", now)).toBeNull();
  });
});

describe("summarizePublications", () => {
  const d = (s: string) => new Date(s);
  it("live since is the first publication", () => {
    const r = summarizePublications("live", d("2026-10-05"), [
      { publishedAt: d("2026-10-03"), stoppedAt: null },
      { publishedAt: d("2026-10-01"), stoppedAt: null },
    ]);
    expect(r).toEqual({ liveSince: d("2026-10-01"), stoppedAt: null });
  });
  it("gestoppt uses the latest stop, else the update time", () => {
    expect(
      summarizePublications("gestoppt", d("2026-10-06"), [{ publishedAt: d("2026-10-01"), stoppedAt: d("2026-10-04") }])
        .stoppedAt
    ).toEqual(d("2026-10-04"));
    expect(summarizePublications("gestoppt", d("2026-10-06"), []).stoppedAt).toEqual(d("2026-10-06"));
  });
  it("no publication means neither live nor stopped", () => {
    expect(summarizePublications("freigegeben", d("2026-10-06"), [])).toEqual({ liveSince: null, stoppedAt: null });
  });
});

describe("tallyInquiries", () => {
  it("counts per post and Messweg", () => {
    const t = tallyInquiries([
      { contentItemId: "a", source: "formular", n: 3 },
      { contentItemId: "a", source: "anruf", n: 1 },
      { contentItemId: "a", source: "buchung", n: 2 },
      { contentItemId: "a", source: "manuell", n: 1 },
      { contentItemId: "b", source: "landing_form", n: 4 },
    ]);
    expect(t.get("a")).toEqual({ total: 7, formular: 3, anruf: 1, buchung: 2, ohne: 1 });
    expect(t.get("b")).toEqual({ total: 4, formular: 4, anruf: 0, buchung: 0, ohne: 0 });
    expect(t.get("c")).toBeUndefined();
  });
});

describe("groupByOverviewStatus", () => {
  it("puts freigegeben and geplant together and keeps group order", () => {
    const groups = groupByOverviewStatus([
      { id: 1, status: "live" },
      { id: 2, status: "geplant" },
      { id: 3, status: "freigegeben" },
      { id: 4, status: "entwurf" },
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Entwurf",
      "Wartet auf Freigabe",
      "Änderung gewünscht",
      "Freigegeben oder geplant",
      "Live",
      "Gestoppt",
    ]);
    expect(groups[3]!.items.map((i) => i.id)).toEqual([2, 3]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual([4]);
  });
});
