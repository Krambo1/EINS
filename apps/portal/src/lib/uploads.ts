/**
 * Shared (client + server) constants for the "Dateien an EINS" general
 * upload flow. Extension allowlists and size caps live here so the client
 * form, the server actions and the /api/uploads dev route all enforce the
 * same rules.
 *
 * No SVG on purpose: uploaded SVGs would be served back with an image/svg+xml
 * content type on the admin passthrough, i.e. stored-XSS surface on the
 * admin origin. Logos with SVG stay confined to the checklist logo profile.
 */

export const UPLOAD_VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v"] as const;

export const UPLOAD_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "heic",
  "heif",
  "gif",
] as const;

export const UPLOAD_DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "zip",
] as const;

export const GENERAL_UPLOAD_EXTENSIONS: readonly string[] = [
  ...UPLOAD_VIDEO_EXTENSIONS,
  ...UPLOAD_IMAGE_EXTENSIONS,
  ...UPLOAD_DOCUMENT_EXTENSIONS,
];

/** Videos go direct-to-storage, so the cap is generous. */
export const MAX_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
/** Documents and images. */
export const MAX_FILE_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/** `accept` attribute for the general upload file input. */
export const GENERAL_UPLOAD_ACCEPT = GENERAL_UPLOAD_EXTENSIONS.map(
  (e) => `.${e}`
).join(",");

/** Lowercased extension of a filename, or "" if it has none. */
export function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

export function isVideoExtension(ext: string): boolean {
  return (UPLOAD_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

/** Per-file byte cap for a given extension. */
export function uploadLimitForExtension(ext: string): number {
  return isVideoExtension(ext) ? MAX_VIDEO_UPLOAD_BYTES : MAX_FILE_UPLOAD_BYTES;
}

export function formatUploadLimit(ext: string): string {
  return isVideoExtension(ext) ? "2 GB" : "100 MB";
}
