import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { entryName, packZip, safeName, splitParts, uniqueNames, zipName, type ZipFile } from "./zip";

const GB = 1024 ** 3;

describe("entryName", () => {
  it("takes the title and the stored file's extension", () => {
    expect(entryName("Teamfoto Empfang", "c1/assets/abc.JPG", "image/jpeg")).toBe("Teamfoto Empfang.jpg");
  });

  it("falls back to the type when the key has no extension", () => {
    expect(entryName("Reel Lippen", "c1/assets/abc", "video/mp4")).toBe("Reel Lippen.mp4");
  });

  it("ignores a query on the key", () => {
    expect(entryName("Bild", "c1/edgecase/bild.png?n=3", null)).toBe("Bild.png");
  });

  it("replaces characters Windows refuses and keeps umlauts", () => {
    expect(entryName('Vorher/Nachher: "Lippen"?', "k.mp4", null)).toBe("Vorher Nachher Lippen.mp4");
    expect(entryName("Porträt Dr. Müller", "k.jpg", null)).toBe("Porträt Dr. Müller.jpg");
  });

  it("does not double the extension", () => {
    expect(entryName("clip.mp4", "k.mp4", null)).toBe("clip.mp4");
  });

  it("keeps long titles under the file system limit", () => {
    const name = entryName("ä".repeat(300), "k.mp4", null);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(240);
    expect(name.endsWith(".mp4")).toBe(true);
  });
});

describe("safeName", () => {
  it("never returns an empty or reserved name", () => {
    expect(safeName("  ...  ")).toBe("Datei");
    expect(safeName("CON")).toBe("CON (Datei)");
  });
});

describe("uniqueNames", () => {
  it("numbers repeats before the extension, ignoring case", () => {
    expect(uniqueNames(["A.mp4", "a.mp4", "A.mp4", "B"])).toEqual(["A.mp4", "a (2).mp4", "A (3).mp4", "B"]);
  });
});

describe("splitParts", () => {
  const f = (size: number | null) => ({ size });

  it("keeps everything in one part when it fits", () => {
    expect(splitParts([f(10), f(20), f(null)], 100)).toHaveLength(1);
  });

  it("starts a new part before the limit is passed", () => {
    const parts = splitParts([f(60), f(30), f(20), f(90)], 100);
    expect(parts.map((p) => p.map((x) => x.size))).toEqual([[60, 30], [20], [90]]);
  });

  it("puts a file larger than a part alone, at the end", () => {
    const parts = splitParts([f(10), f(2 * GB), f(10)], GB);
    expect(parts.map((p) => p.map((x) => x.size))).toEqual([[10, 10], [2 * GB]]);
  });
});

describe("zipName", () => {
  it("names parts only when there are several", () => {
    expect(zipName("Medien Praxis 29.10.2026", 1, 1)).toBe("Medien Praxis 29.10.2026.zip");
    expect(zipName("Medien Praxis 29.10.2026", 2, 3)).toBe("Medien Praxis 29.10.2026, Teil 2 von 3.zip");
  });
});

describe("packZip", () => {
  it("packs every file under its name, byte for byte, and reports the bytes", async () => {
    const content: Record<string, Uint8Array> = {
      "/a": new Uint8Array(70_000).map((_, i) => i % 251),
      "/b": new TextEncoder().encode("Bild"),
    };
    const files: ZipFile[] = [
      { name: "Porträt.jpg", url: "/a", downloadUrl: "/a", size: 70_000, modified: "2026-10-24T10:00:00Z" },
      { name: "Reel.mp4", url: "/b", downloadUrl: "/b", size: 4, modified: "2026-10-28T10:00:00Z" },
    ];
    let seen = 0;
    const blob = await packZip(
      files,
      (n) => (seen += n),
      async (url) => new Response(content[url]! as BodyInit)
    );
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(out)).toEqual(["Porträt.jpg", "Reel.mp4"]);
    expect(out["Porträt.jpg"]).toEqual(content["/a"]);
    expect(out["Reel.mp4"]).toEqual(content["/b"]);
    expect(seen).toBe(70_004);
  });

  it("fails when a file cannot be read", async () => {
    const files: ZipFile[] = [{ name: "x.mp4", url: "/x", downloadUrl: "/x", size: 1, modified: "2026-10-28T10:00:00Z" }];
    await expect(packZip(files, () => {}, async () => new Response("nein", { status: 403 }))).rejects.toThrow();
  });
});
