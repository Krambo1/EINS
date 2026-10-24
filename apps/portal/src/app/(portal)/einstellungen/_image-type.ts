/**
 * B-16: detect the real image type from the file's first bytes instead of
 * trusting the client-supplied `File.type`. Only the three formats the
 * avatar cropper can produce are recognised; anything else (SVG, HTML,
 * renamed executables, truncated files) returns null.
 */

export type SniffedImage =
  | { mime: "image/png"; ext: "png" }
  | { mime: "image/jpeg"; ext: "jpg" }
  | { mime: "image/webp"; ext: "webp" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

export function sniffImageType(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return { mime: "image/png", ext: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  // RIFF container: "RIFF" <4-byte size> "WEBP" <chunk "VP8 " | "VP8L" | "VP8X">
  if (
    startsWith(bytes, ascii("RIFF")) &&
    startsWith(bytes, ascii("WEBP"), 8) &&
    (startsWith(bytes, ascii("VP8 "), 12) ||
      startsWith(bytes, ascii("VP8L"), 12) ||
      startsWith(bytes, ascii("VP8X"), 12))
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}
