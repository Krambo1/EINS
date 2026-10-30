import { Zip, ZipPassThrough } from "fflate";

/**
 * "Alle herunterladen" in the Medien card, the way Google Drive zips a
 * folder: the server only lists the files with fresh signed links
 * (/api/inhalte/medien), the browser fetches them straight from storage and
 * packs them. The bytes never pass a Vercel function, whose time limit would
 * cut a slow multi-GB download off half way.
 *
 * Drive splits big downloads into several ZIP files; so does this, at 1 GB,
 * because a part is held in the browser's memory until it is saved (Safari
 * and Firefox cannot write a stream to disk). A single file larger than a
 * part is saved as it is, without a ZIP around it.
 */
export const ZIP_PART_BYTES = 1024 ** 3;

/** One file of the list the route returns. */
export type ZipFile = {
  /** File name inside the ZIP, unique within the list. */
  name: string;
  /** Signed link to read the file (fetch). */
  url: string;
  /** Signed link that saves the file under `name` (for a file saved alone). */
  downloadUrl: string;
  size: number | null;
  /** ISO date the file was added. */
  modified: string;
};

/** Characters Windows or macOS refuse in a file name, and control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
};

/** A name every file system accepts: no forbidden characters, no trailing dot. */
export function safeName(raw: string, fallback = "Datei"): string {
  const base = raw.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!base) return fallback;
  return RESERVED.test(base) ? `${base} (${fallback})` : base;
}

/** The stored file's extension (".mp4"), from its key or else its type. */
function extensionOf(storageKey: string, mime: string | null): string {
  const last = storageKey.split("?")[0]!.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot > 0 && last.length - dot <= 6) return last.slice(dot).toLowerCase();
  return (mime && EXT_BY_MIME[mime.toLowerCase()]) || "";
}

/** "Teamfoto Empfang.jpg": the title as the file name, with the file's extension. */
export function entryName(title: string, storageKey: string, mime: string | null): string {
  const ext = extensionOf(storageKey, mime);
  // Long titles stay whole up to what file systems allow (255 bytes).
  let base = safeName(title);
  while (new TextEncoder().encode(base + ext).length > 240) base = base.slice(0, -1).trimEnd();
  return base.toLowerCase().endsWith(ext) ? base : base + ext;
}

/** Same names get " (2)", " (3)" before the extension, as Windows does. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Files into parts of at most `max` bytes, in list order. A file larger than
 * a part is a part of its own; those come last, after the ZIP parts.
 */
export function splitParts<T extends { size: number | null }>(files: T[], max = ZIP_PART_BYTES): T[][] {
  const parts: T[][] = [];
  const alone: T[][] = [];
  let current: T[] = [];
  let held = 0;
  for (const f of files) {
    const size = f.size ?? 0;
    if (size > max) {
      alone.push([f]);
      continue;
    }
    if (current.length > 0 && held + size > max) {
      parts.push(current);
      current = [];
      held = 0;
    }
    current.push(f);
    held += size;
  }
  if (current.length > 0) parts.push(current);
  return [...parts, ...alone];
}

/** "Medien Praxis Dr. Demo 29.10.2026.zip", or "…, Teil 2 von 3.zip". */
export function zipName(base: string, part: number, parts: number): string {
  return parts > 1 ? `${base}, Teil ${part} von ${parts}.zip` : `${base}.zip`;
}

/** Hand the browser a part to save, the way a download link would. */
export function saveAs(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Pack files into one ZIP, read one after the other and stored as they are
 * (videos and images do not get smaller). `onBytes` hears every chunk read,
 * for the progress. The ZIP is gathered in pieces of 32 MB, so the browser
 * can move them out of the page's memory.
 */
export async function packZip(
  files: ZipFile[],
  onBytes: (n: number) => void,
  load: (url: string) => Promise<Response> = (url) => fetch(url)
): Promise<Blob> {
  const pieces: Blob[] = [];
  let chunks: Uint8Array[] = [];
  let held = 0;
  let failed: Error | null = null;
  const flush = () => {
    if (chunks.length === 0) return;
    pieces.push(new Blob(chunks as BlobPart[]));
    chunks = [];
    held = 0;
  };
  const zip = new Zip((err, data) => {
    if (err) {
      failed = err;
      return;
    }
    chunks.push(data);
    held += data.length;
    if (held >= 32 * 1024 * 1024) flush();
  });

  for (const f of files) {
    const res = await load(f.url);
    if (!res.ok || !res.body) throw new Error(`zip: ${f.name} answered ${res.status}`);
    const entry = new ZipPassThrough(f.name);
    entry.mtime = new Date(f.modified);
    zip.add(entry);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      entry.push(value);
      onBytes(value.length);
      if (failed) throw failed;
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failed) throw failed;
  flush();
  return new Blob(pieces, { type: "application/zip" });
}
