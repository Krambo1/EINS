"use client";

import type { UploadTarget } from "@/server/uploads";

/**
 * Browser-side upload executor. Sends the file straight to the target the
 * server minted: an R2 presigned PUT in prod, the /api/uploads POST sink in
 * local dev. XHR instead of fetch because fetch still has no upload
 * progress events, and a 500 MB video without a progress bar reads as a
 * frozen page.
 */
export function uploadFileToTarget(
  target: Pick<UploadTarget, "mode" | "url">,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.mode === "presigned" ? "PUT" : "POST", target.url);
    // Must match the content type baked into the presigned signature (see
    // normalizeContentType server-side).
    xhr.setRequestHeader(
      "Content-Type",
      file.type && file.type.length <= 200 ? file.type : "application/octet-stream"
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else if (xhr.status === 413) {
        reject(new Error("too_large"));
      } else {
        reject(new Error(`upload_failed_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network_error"));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.send(file);
  });
}

/**
 * German, plain-language text for an error thrown by `uploadFileToTarget`.
 * Shared by every upload surface so size, expiry and connection problems read
 * the same everywhere.
 */
export function uploadErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "too_large") {
    return "Die Datei ist zu groß. Bitte verkleinern Sie sie oder schicken Sie einen Freigabe-Link.";
  }
  if (code === "network_error") {
    return "Die Verbindung ist beim Hochladen abgebrochen. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.";
  }
  if (code === "aborted") return "Das Hochladen wurde abgebrochen.";
  if (code === "upload_failed_403") {
    return "Der Upload-Link ist abgelaufen. Bitte versuchen Sie es erneut.";
  }
  return "Hochladen fehlgeschlagen. Bitte versuchen Sie es erneut.";
}
