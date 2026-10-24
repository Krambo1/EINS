import { describe, expect, it } from "vitest";
import { sniffImageType } from "./_image-type";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p))
  );

describe("sniffImageType", () => {
  it("recognises PNG, JPEG and WebP by their signatures", () => {
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toEqual({
      mime: "image/png",
      ext: "png",
    });
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
    });
    for (const chunk of ["VP8 ", "VP8L", "VP8X"]) {
      expect(sniffImageType(bytes("RIFF", [0x24, 0, 0, 0], "WEBP", chunk, [0, 0]))).toEqual({
        mime: "image/webp",
        ext: "webp",
      });
    }
  });

  it("rejects files whose bytes are not one of the three formats", () => {
    expect(sniffImageType(bytes("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))).toBeNull();
    expect(sniffImageType(bytes("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(bytes("GIF89a", [0, 0, 0, 0]))).toBeNull();
    // RIFF but not WebP (e.g. a WAV file)
    expect(sniffImageType(bytes("RIFF", [0x24, 0, 0, 0], "WAVE", "fmt "))).toBeNull();
    // WebP header without a VP8 chunk
    expect(sniffImageType(bytes("RIFF", [0x24, 0, 0, 0], "WEBP"))).toBeNull();
  });

  it("rejects empty and truncated input", () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
  });
});
